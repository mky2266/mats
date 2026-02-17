import ccxt from 'ccxt';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, URL } from 'url';
import { createRequire } from 'module';
import { ATR } from 'technicalindicators';
import { 
    EXCHANGE_NAME, 
    getExchangeConfig, 
    validateApiKeys, 
    normalizeSymbol,
    normalizeTimeframe,
    logExchangeInfo
} from './exchange_config.js';

// --- API Key Loading Fix for ES Modules ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') }); 

// --- START: FIX for HANKED_SIZE and constants ---
const HANKED_SIZE = 20; 
const CONFIG = {
    symbol: 'DUSK/USDT:USDT',    // 修正為合約市場格式
    investment: 180,
    gridCount: 10,          
    leverage: 1,            
    checkInterval: 30000,   
    
    // ATR 動態網格設定
    useAtrGrid: true,
    atrPeriod: 14,
    atrMultiplier: 1.2,
    
    // 自動重置 (無限網格)
    autoRebalance: true,
    rebalanceCooldown: 60000 * 5, 

    // 動態輪動設定（優化版）
    enableRotation: true,                      // 啟用自動輪動
    rotationInterval: 60000 * 60 * 4,          // 每 4 小時檢查一次
    rotationImprovementThreshold: 1.15,        // 波動性改善 15% 以上才切換（降低門檻）
    maxDrawdownForRotation: -0.05,             // 虧損 5% 以上也觸發輪動
    minVolumeForRotation: 1000000,             // 最低成交量要求（避免流動性差的幣種）
    rotationCooldown: 60000 * 60 * 2,          // 輪動後至少 2 小時才能再次輪動

    // 模式
    simMode: false,

    // ===== 趨勢過濾設定 =====
    trendFilterEnabled: true,
    trendMaPeriod: 20,               // 使用 20 根 4h K 線的 MA
    trendDeviationThreshold: 0.03,   // 價格偏離 MA 超過 3% 視為趨勢市場，暫停

    // ===== 風控設定 =====
    stopLossEnabled: true,
    stopLossPercent: 0.15,       // 單次虧損超過投資額 15% 停止（180U × 15% = 27U）
    dailyLossLimit: 0.20,        // 每日虧損超過投資額 20% 暫停到隔天（36U）
    maxDrawdownPercent: 0.30,    // 從高點回撤超過 30% 停止（54U）
};
// --- END: FIX for HANKED_SIZE and constants ---

// ========== 初始化交易所 ==========
function initExchange() {
    validateApiKeys();
    const config = getExchangeConfig();
    
    const ExchangeClass = ccxt[config.id];
    if (!ExchangeClass) {
        throw new Error(`CCXT 不支援交易所: ${config.id}`);
    }
    
    const exchangeConfig = {
        apiKey: config.apiKey,
        secret: config.secret,
        enableRateLimit: config.enableRateLimit,
        options: config.options
    };
    
    if (config.password) {
        exchangeConfig.password = config.password;
    }
    
    return new ExchangeClass(exchangeConfig);
}

const exchange = initExchange();

// 網格狀態
let gridState = {
    isActive: false,
    upperPrice: 0,
    lowerPrice: 0,
    gridStep: 0,
    orders: [],
    lastRebalanceTime: 0,
    lastRotationCheck: Date.now(),
    lastRotationTime: 0,
    entryEquity: CONFIG.investment,

    // 風控狀態
    peakEquity: CONFIG.investment,  // 歷史最高權益（用於計算回撤）
    dailyLoss: 0,                   // 當日累計虧損
    dailyLossDate: '',              // 記錄日期（用於每日重置）
    stopLossTriggered: false,       // 停損觸發標記
};

function log(msg) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${msg}`);
}

// NanoClaw IPC 設定：透過寫入 JSON 檔案讓 NanoClaw 發送 WhatsApp 訊息
const NANOCLAW_IPC_DIR = process.env.NANOCLAW_IPC_DIR || '/home/mky/nanoclaw/data/ipc/main/messages';
const NANOCLAW_CHAT_JID = process.env.NANOCLAW_CHAT_JID || '886915721620@s.whatsapp.net';

function notifyUser(message) {
    log(`📢 通知: ${message}`);
    try {
        if (!fs.existsSync(NANOCLAW_IPC_DIR)) {
            log(`⚠️ NanoClaw IPC 目錄不存在: ${NANOCLAW_IPC_DIR}，僅記錄 log`);
            return;
        }
        const payload = JSON.stringify({
            type: 'message',
            chatJid: NANOCLAW_CHAT_JID,
            text: `🤖 *網格機器人*\n${message}`
        });
        const filename = path.join(NANOCLAW_IPC_DIR, `mats_${Date.now()}.json`);
        fs.writeFileSync(filename, payload, 'utf-8');
        log(`✅ 通知已送出至 NanoClaw IPC`);
    } catch (e) {
        log(`⚠️ 無法發送通知: ${e.message}`);
    }
}

// ===== 風控機制 =====

async function getCurrentEquity() {
    try {
        const balance = await exchange.fetchBalance();
        return parseFloat(balance.total?.USDT || balance.USDT?.total || 0);
    } catch (e) {
        log(`⚠️ 無法取得帳戶餘額: ${e.message}`);
        return null;
    }
}

async function checkStopLoss() {
    if (!CONFIG.stopLossEnabled || CONFIG.simMode) return false;

    const equity = await getCurrentEquity();
    if (equity === null) return false;

    const today = new Date().toISOString().slice(0, 10);

    // 每日重置
    if (gridState.dailyLossDate !== today) {
        gridState.dailyLoss = 0;
        gridState.dailyLossDate = today;
        log(`📅 新的一天，每日虧損計數重置`);
    }

    // 更新歷史最高權益
    if (equity > gridState.peakEquity) {
        gridState.peakEquity = equity;
    }

    const entryEquity = gridState.entryEquity || CONFIG.investment;
    const currentLoss = entryEquity - equity;
    const drawdown = gridState.peakEquity - equity;

    // 第一道：單次虧損停損
    const stopLossLimit = CONFIG.investment * CONFIG.stopLossPercent;
    if (currentLoss >= stopLossLimit) {
        log(`🛑 [停損] 單次虧損 ${currentLoss.toFixed(2)}U 超過上限 ${stopLossLimit.toFixed(2)}U，停止交易！`);
        notifyUser(`🛑 停損觸發！虧損 ${currentLoss.toFixed(2)}U 超過 ${(CONFIG.stopLossPercent * 100).toFixed(0)}% 上限`);
        gridState.stopLossTriggered = true;
        return true;
    }

    // 第二道：每日虧損上限
    const dailyLossLimit = CONFIG.investment * CONFIG.dailyLossLimit;
    gridState.dailyLoss = Math.max(gridState.dailyLoss, currentLoss);
    if (gridState.dailyLoss >= dailyLossLimit) {
        log(`🛑 [每日停損] 今日虧損 ${gridState.dailyLoss.toFixed(2)}U 超過每日上限 ${dailyLossLimit.toFixed(2)}U，暫停到明天！`);
        notifyUser(`🛑 每日停損觸發！今日虧損 ${gridState.dailyLoss.toFixed(2)}U`);
        gridState.stopLossTriggered = true;
        return true;
    }

    // 第三道：最大回撤保護
    const maxDrawdownLimit = CONFIG.investment * CONFIG.maxDrawdownPercent;
    if (drawdown >= maxDrawdownLimit) {
        log(`🛑 [回撤停損] 從高點回撤 ${drawdown.toFixed(2)}U 超過上限 ${maxDrawdownLimit.toFixed(2)}U，停止交易！`);
        notifyUser(`🛑 回撤停損觸發！從高點回撤 ${drawdown.toFixed(2)}U`);
        gridState.stopLossTriggered = true;
        return true;
    }

    log(`✅ 風控檢查正常 | 當前權益: ${equity.toFixed(2)}U | 虧損: ${currentLoss.toFixed(2)}U | 回撤: ${drawdown.toFixed(2)}U`);
    return false;
}

async function getMarketPrice(symbol = CONFIG.symbol) {
    let retries = 3;
    while (retries > 0) {
        try {
            const ticker = await exchange.fetchTicker(symbol);
            return ticker.last;
        } catch (e) {
            retries--;
            if (retries === 0) {
                log(`獲取價格失敗 ${symbol}: ${e.message}`);
                throw e;
            }
            log(`獲取價格重試... (剩餘 ${retries} 次)`);
            await new Promise(r => setTimeout(r, 2000)); // 等待 2 秒重試
        }
    }
}

async function getATR(symbol, period) {
    try {
        const timeframe = normalizeTimeframe('1h');
        const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, undefined, period + 10);
        const highs = ohlcv.map(c => c[2]);
        const lows = ohlcv.map(c => c[3]);
        const closes = ohlcv.map(c => c[4]);
        const atr = ATR.calculate({ high: highs, low: lows, close: closes, period: period });
        return atr[atr.length - 1];
    } catch (e) {
        log(`ATR計算失敗 ${symbol}: ${e.message}`);
        return 0;
    }
}

async function getVolatilityScore(symbol) {
    const price = await getMarketPrice(symbol);
    const atr = await getATR(symbol, 14);
    if (!price || !atr) return 0;
    return (atr / price);
}

// ===== 趨勢過濾 =====
// 計算簡單移動平均線（SMA）
async function getSMA(symbol, period, timeframe = '4h') {
    try {
        const tf = normalizeTimeframe(timeframe);
        const ohlcv = await exchange.fetchOHLCV(symbol, tf, undefined, period + 5);
        const closes = ohlcv.map(c => c[4]);
        if (closes.length < period) return null;
        const slice = closes.slice(-period);
        return slice.reduce((a, b) => a + b, 0) / period;
    } catch (e) {
        log(`SMA計算失敗 ${symbol}: ${e.message}`);
        return null;
    }
}

// 判斷是否為橫盤市場（適合網格交易）
// 若價格偏離 MA 超過閾值，視為趨勢市場，暫停交易
async function isSidewaysMarket(symbol) {
    if (!CONFIG.trendFilterEnabled) return true; // 未啟用則預設允許交易

    const price = await getMarketPrice(symbol);
    const ma = await getSMA(symbol, CONFIG.trendMaPeriod);

    if (!price || !ma) {
        log(`⚠️ 趨勢過濾：無法計算 MA，允許交易`);
        return true;
    }

    const deviation = Math.abs(price - ma) / ma;
    const isSideways = deviation <= CONFIG.trendDeviationThreshold;

    log(`📊 趨勢過濾 | 價格: ${price.toFixed(4)} | MA${CONFIG.trendMaPeriod}: ${ma.toFixed(4)} | 偏離: ${(deviation * 100).toFixed(2)}% | ${isSideways ? '✅ 橫盤' : '⚠️ 趨勢中'}`);
    return isSideways;
}

async function readMarketData() {
    try {
        const marketDataPath = path.join(__dirname, 'market_data.json'); 
        const data = fs.readFileSync(marketDataPath, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        log(`Failed to read market data from ${CONFIG.outputFile}: ${e.message}`);
        return null;
    }
}

// 從 backtest.db 讀取幣種的回測分數（若有）
// 回傳 { pnl, drawdown } 或 null
const _require = createRequire(import.meta.url);
let _btDb = null;

function getBacktestScore(symbol) {
    try {
        const dbPath = path.join(__dirname, 'backtest.db');
        if (!fs.existsSync(dbPath)) return null;
        if (!_btDb) {
            const Database = _require('better-sqlite3');
            _btDb = new Database(dbPath, { readonly: true });
        }
        const row = _btDb.prepare(
            `SELECT AVG(total_pnl_pct) as avg_pnl, AVG(max_drawdown) as avg_dd
             FROM backtest_runs WHERE symbol = ?`
        ).get(symbol);
        if (!row || row.avg_pnl === null) return null;
        return { pnl: row.avg_pnl, drawdown: row.avg_dd };
    } catch (e) {
        return null;
    }
}

async function findBestCandidateFromData() {
    log(`🔍 讀取 market_data.json 尋找最佳網格幣種...`);
    const marketData = await readMarketData();

    if (!marketData || marketData.length === 0) {
        log("❌ 沒有市場數據，保持當前幣種。");
        return { symbol: CONFIG.symbol, score: 0 };
    }

    // 過濾：只選擇成交量足夠的幣種
    const validCandidates = marketData.filter(item => {
        // 轉換符號格式：BTCUSDT -> BTC/USDT:USDT
        if (!item.symbol.includes('/') && item.symbol.endsWith('USDT')) {
            const base = item.symbol.replace('USDT', '');
            item.symbol = `${base}/USDT:USDT`;
        }
        if (CONFIG.minVolumeForRotation && item.volume_4h) {
            return item.volume_4h > CONFIG.minVolumeForRotation;
        }
        return true;
    });

    if (validCandidates.length === 0) {
        log("❌ 沒有符合條件的幣種，保持當前幣種。");
        return { symbol: CONFIG.symbol, score: 0 };
    }

    // 計算波動性分數
    for (let item of validCandidates) {
        if (!item.volatilityScore || item.volatilityScore === 0) {
            const score = await getVolatilityScore(item.symbol);
            item.volatilityScore = score;
        }
    }

    // 嘗試從 backtest.db 取得回測分數，做綜合評分
    const scored = validCandidates.map(item => {
        const vol = typeof item.volatilityScore === 'number' ? item.volatilityScore : 0;
        const bt = getBacktestScore(item.symbol);
        let finalScore;
        if (bt && bt.pnl > 0) {
            // 有回測資料：波動性 50% + 回測報酬 30% + 低回撤 20%
            const btScore = (bt.pnl / 100) * 0.3 - (bt.drawdown / 100) * 0.2;
            finalScore = vol * 0.5 + btScore;
            log(`  ${item.symbol}: 波動${(vol*100).toFixed(1)}% | 回測+${bt.pnl.toFixed(1)}% | 回撤${bt.drawdown.toFixed(1)}% → 綜合${(finalScore*100).toFixed(2)}`);
        } else {
            // 無回測資料：純波動性
            finalScore = vol;
            log(`  ${item.symbol}: 波動${(vol*100).toFixed(1)}% (無回測資料)`);
        }
        return { ...item, finalScore };
    });

    const bestCandidate = scored.reduce((prev, curr) =>
        curr.finalScore > prev.finalScore ? curr : prev
    , { symbol: CONFIG.symbol, finalScore: 0 });

    log(`✅ 最佳幣種: ${bestCandidate.symbol} (綜合分數: ${(bestCandidate.finalScore * 100).toFixed(2)})`);
    return { symbol: bestCandidate.symbol, score: bestCandidate.finalScore };
}

async function closeAllPositions(symbol) {
    if (CONFIG.simMode) return;
    try {
        // 取消指定 symbol 的掛單
        log(`🗑️ 取消 ${symbol} 的所有掛單...`);
        await exchange.cancelAllOrders(symbol);

        // 清除所有持倉（不限 symbol，避免輪動後舊倉位殘留）
        log(`📊 檢查所有持倉...`);
        const positions = await exchange.fetchPositions();
        for (const pos of positions) {
            const contracts = parseFloat(pos.contracts);
            if (contracts > 0) {
                const posSymbol = pos.symbol;
                const side = pos.side === 'long' ? 'sell' : 'buy';
                log(`🔄 平倉 ${posSymbol} ${pos.side} 倉位: ${contracts} 張`);
                try {
                    await exchange.createOrder(posSymbol, 'market', side, contracts, undefined, { reduceOnly: true });
                } catch (e2) {
                    log(`❌ 平倉 ${posSymbol} 失敗: ${e2.message}`);
                }
            }
        }
        log(`✅ 所有倉位已清空`);
    } catch (e) {
        log(`❌ 平倉失敗: ${e.message}`);
    }
}

async function initializeGrid() {
    try {
        // 從 market_data.json 自動選最佳交易對
        log(`🔍 從 market_data.json 自動選擇交易對...`);
        const best = await findBestCandidateFromData();
        if (!best || !best.symbol || best.score === 0) {
            log(`⚠️ market_data.json 無可用數據，暫停交易，等待下次掃描...`);
            return;
        }
        if (best.symbol !== CONFIG.symbol) {
            log(`📥 自動選擇交易對: ${best.symbol} (波動性: ${(best.score * 100).toFixed(2)}%)`);
            CONFIG.symbol = best.symbol;
        }

        let currentSymbol = CONFIG.symbol;

        // 趨勢過濾：橫盤才開網格
        const sideways = await isSidewaysMarket(currentSymbol);
        if (!sideways) {
            log(`⚠️ [趨勢過濾] ${currentSymbol} 目前處於趨勢行情，暫停開網格，等待橫盤...`);
            notifyUser(`⚠️ 趨勢過濾：${currentSymbol} 趨勢行情，暫停開網格`);
            return;
        }

        // 重置前先平掉所有倉位，避免倉位累積（包含首次啟動）
        log(`🧹 初始化前先清空所有倉位...`);
        await closeAllPositions(currentSymbol);

        if (CONFIG.enableRotation && Date.now() - gridState.lastRotationCheck > CONFIG.rotationInterval) {
            gridState.lastRotationCheck = Date.now();
            
            log(`🔄 執行定期輪動檢查...`);
            const best = await findBestCandidateFromData(); 
            
            if (best.symbol !== CONFIG.symbol) {
                // 獲取當前幣種的波動性
                const currentVolatility = await getVolatilityScore(CONFIG.symbol);
                log(`📊 當前幣種 ${CONFIG.symbol} 波動性: ${(currentVolatility * 100).toFixed(2)}%`);
                log(`📊 候選幣種 ${best.symbol} 波動性: ${(best.score * 100).toFixed(2)}%`);
                
                // 判斷是否切換
                const improvementRatio = best.score / currentVolatility;
                log(`📈 改善比率: ${improvementRatio.toFixed(2)}x (需要 > ${CONFIG.rotationImprovementThreshold}x)`);
                
                if (improvementRatio > CONFIG.rotationImprovementThreshold) {
                    log(`✅ 波動性改善 ${((improvementRatio - 1) * 100).toFixed(1)}%，觸發輪動！`);
                    await rotateSymbol(best.symbol);
                    return; 
                } else {
                    log(`⏸️ 改善幅度不足，保持當前幣種`);
                }
            } else {
                log(`✅ 當前幣種已是最佳選擇`);
            }
        }

        const currentPrice = await getMarketPrice(currentSymbol);
        let gridStep = 0;
        let atrMultiplier = CONFIG.atrMultiplier;

        if (CONFIG.useAtrGrid) {
            const atr = await getATR(currentSymbol, CONFIG.atrPeriod);
            // 動態 ATR 倍數：根據 ATR/價格比例自動調整
            // ATR/價格 > 5% → 波動大，格距縮小（倍數降低），避免掛單太稀疏
            // ATR/價格 < 1% → 波動小，格距放大（倍數提高），確保有利潤空間
            const atrRatio = atr / currentPrice;
            if (atrRatio > 0.05) {
                atrMultiplier = 0.8;  // 波動大：縮小格距
            } else if (atrRatio > 0.03) {
                atrMultiplier = 1.0;
            } else if (atrRatio > 0.015) {
                atrMultiplier = 1.2;  // 預設
            } else {
                atrMultiplier = 1.5;  // 波動小：放大格距
            }
            gridStep = atr * atrMultiplier;
            log(`📐 ATR: ${atr.toFixed(4)} | ATR/價格比: ${(atrRatio*100).toFixed(2)}% | 格距倍數: ${atrMultiplier}x`);
        } else {
            gridStep = currentPrice * 0.01;
        }

        const range = gridStep * CONFIG.gridCount;
        const upperPrice = currentPrice + (range / 2);
        const lowerPrice = currentPrice - (range / 2);

        log(`=== 初始化網格 [${currentSymbol}] ===`);
        log(`區間: ${lowerPrice.toFixed(4)} - ${upperPrice.toFixed(4)}`);
        log(`格距: ${gridStep.toFixed(4)} | 格數: ${CONFIG.gridCount} | ATR倍數: ${atrMultiplier}x`);

        if (!CONFIG.simMode) {
            await exchange.cancelAllOrders(currentSymbol);
            await exchange.setLeverage(CONFIG.leverage, currentSymbol);
        }

        // Dynamic calculation of quantity per grid - ensure proper precision
        // 減少每格使用的資金，避免保證金不足
        const notionalPerGrid = (CONFIG.investment * CONFIG.leverage * 0.8) / CONFIG.gridCount; // 使用 80% 避免保證金不足
        let newOrders = [];

        // 獲取交易對的精度信息
        let market = null;
        try {
            await exchange.loadMarkets();
            market = exchange.market(currentSymbol);
        } catch (e) {
            log(`無法獲取市場信息: ${e.message}`);
        }

        for (let i = 0; i < CONFIG.gridCount; i++) {
            const price = lowerPrice + (i * gridStep);
            
            if (Math.abs(price - currentPrice) / currentPrice < 0.002) continue;

            let side = price < currentPrice ? 'buy' : 'sell';
            
            // Calculate amount with proper precision
            let amount = notionalPerGrid / price;
            
            // 使用交易所的精度規則
            if (market && market.precision && market.precision.amount !== undefined) {
                const precision = market.precision.amount;
                amount = exchange.amountToPrecision(currentSymbol, amount);
            } else {
                amount = Math.floor(amount); // 預設取整數
            }
            
            // 檢查最小訂單量
            if (market && market.limits && market.limits.amount && market.limits.amount.min) {
                if (amount < market.limits.amount.min) {
                    log(`⚠️ 數量 ${amount} 小於最小值 ${market.limits.amount.min}，跳過此網格`);
                    continue;
                }
            }
            
            if (amount === 0 || amount < 1) continue; 

            if (!CONFIG.simMode) {
                try {
                    const params = { 'timeInForce': 'GTX' }; 
                    const order = await exchange.createOrder(currentSymbol, 'limit', side, amount, price, params);
                    newOrders.push({ id: order.id, price, side, status: 'open' });
                    log(`✅ [實盤] 掛單成功: ${side} @ ${price.toFixed(4)} (量: ${amount})`);
                } catch (e) {
                    log(`❌ [實盤] 掛單失敗 (${side} @ ${price}): binance ${JSON.stringify(e.message)}`);
                    // 如果是保證金不足，停止後續掛單
                    if (e.message && e.message.includes('Margin is insufficient')) {
                        log(`⚠️ 保證金不足，停止掛單。請減少 gridCount 或 investment`);
                        break;
                    }
                }
                await new Promise(r => setTimeout(r, 500)); // 增加延遲到 500ms
            } else {
                newOrders.push({ id: `sim_${Date.now()}_${i}`, price, side, status: 'open' });
            }
        }

        gridState = {
            isActive: true,
            upperPrice,
            lowerPrice,
            gridStep,
            orders: newOrders,
            lastRebalanceTime: Date.now(),
            lastRotationCheck: Date.now(),
            entryEquity: gridState.entryEquity
        };

        notifyUser(`🕸️ 網格機器人啟動 [${currentSymbol}]\n區間: ${lowerPrice.toFixed(4)} - ${upperPrice.toFixed(4)}`);

    } catch (e) {
        log(`初始化失敗: ${e.message}`);
    }
}

async function rotateSymbol(newSymbol) {
    // 檢查輪動冷卻
    if (CONFIG.rotationCooldown && gridState.lastRotationTime > 0) {
        const timeSinceLastRotation = Date.now() - gridState.lastRotationTime;
        if (timeSinceLastRotation < CONFIG.rotationCooldown) {
            const remainingTime = Math.ceil((CONFIG.rotationCooldown - timeSinceLastRotation) / 60000);
            log(`⏸️ 輪動冷卻中，還需等待 ${remainingTime} 分鐘`);
            return;
        }
    }
    
    log(`🔄 ========== 開始輪動 ==========`);
    log(`📤 舊幣種: ${CONFIG.symbol}`);
    log(`📥 新幣種: ${newSymbol}`);
    notifyUser(`🔄 網格輪動！切換至 ${newSymbol}`);

    gridState.isActive = false;
    
    if (!CONFIG.simMode) {
        try {
            log(`🗑️ 取消 ${CONFIG.symbol} 的所有訂單...`);
            await exchange.cancelAllOrders(CONFIG.symbol);
            
            log(`📊 檢查 ${CONFIG.symbol} 的持倉...`);
            const positions = await exchange.fetchPositions([CONFIG.symbol]);
            for (const pos of positions) {
                if (parseFloat(pos.contracts) > 0) {
                    const side = pos.side === 'long' ? 'sell' : 'buy'; 
                    log(`🔄 平倉 ${pos.side} 倉位: ${pos.contracts} 張`);
                    await exchange.createOrder(CONFIG.symbol, 'market', side, pos.contracts, undefined, { reduceOnly: true });
                }
            }
            log(`✅ ${CONFIG.symbol} 已完全平倉`);
        } catch(e) {
            log(`❌ 平倉失敗: ${e.message}`);
        }
    }

    CONFIG.symbol = newSymbol;
    gridState.lastRotationTime = Date.now();
    log(`🔄 ========== 輪動完成 ==========`);
    
    await initializeGrid();
}

// ===== 每日報表 =====
let dailyStats = {
    tradeCount: 0,      // 今日成交次數
    lastReportDate: '', // 上次報表日期
};

async function sendDailyReport() {
    const today = new Date().toISOString().slice(0, 10);
    if (dailyStats.lastReportDate === today) return; // 今天已發過

    const equity = await getCurrentEquity();
    const initialEquity = gridState.entryEquity || CONFIG.investment;
    const pnl = equity !== null ? (equity - initialEquity).toFixed(2) : '無法取得';
    const pnlPercent = equity !== null ? (((equity - initialEquity) / initialEquity) * 100).toFixed(2) : '-';

    const report = [
        `📊 每日交易報表 ${today}`,
        `━━━━━━━━━━━━━━━━`,
        `交易幣種: ${CONFIG.symbol}`,
        `帳戶權益: ${equity !== null ? equity.toFixed(2) + ' USDT' : '無法取得'}`,
        `當日盈虧: ${pnl} USDT (${pnlPercent}%)`,
        `今日成交: ${dailyStats.tradeCount} 次`,
        `每日虧損: ${gridState.dailyLoss.toFixed(2)} USDT`,
        `最高權益: ${gridState.peakEquity.toFixed(2)} USDT`,
    ].join('\n');

    log(`\n${report}`);
    notifyUser(report);

    // 重置當日統計
    dailyStats.tradeCount = 0;
    dailyStats.lastReportDate = today;
}

function scheduleDailyReport() {
    const now = new Date();
    const next8am = new Date();
    next8am.setHours(8, 0, 0, 0);
    if (now >= next8am) {
        next8am.setDate(next8am.getDate() + 1);
    }
    const msUntil8am = next8am - now;
    log(`📅 每日報表將於 ${next8am.toLocaleString()} 發送`);
    setTimeout(async () => {
        await sendDailyReport();
        setInterval(sendDailyReport, 24 * 60 * 60 * 1000); // 之後每 24 小時
    }, msUntil8am);
}

async function monitorGrid() {
    if (!gridState.isActive) await initializeGrid();

    scheduleDailyReport();

    while (true) {
        try {
            // 0. 風控停損檢查
            if (CONFIG.stopLossEnabled) {
                const shouldStop = await checkStopLoss();
                if (shouldStop) {
                    log(`🛑 風控觸發，執行全部平倉並停止機器人...`);
                    await closeAllPositions(CONFIG.symbol);
                    log(`🛑 機器人已停止。請檢查帳戶狀況後手動重啟。`);
                    process.exit(1);
                }
            }

            const price = await getMarketPrice();

            // 1. 輪動檢查
            if (CONFIG.enableRotation && Date.now() - gridState.lastRotationCheck > CONFIG.rotationInterval) {
                gridState.lastRotationCheck = Date.now();
                
                log(`🔄 執行定期輪動檢查...`);
                const best = await findBestCandidateFromData(); 
                
                if (best.symbol !== CONFIG.symbol) {
                    // 獲取當前幣種的波動性
                    const currentVolatility = await getVolatilityScore(CONFIG.symbol);
                    log(`📊 當前幣種 ${CONFIG.symbol} 波動性: ${(currentVolatility * 100).toFixed(2)}%`);
                    log(`📊 候選幣種 ${best.symbol} 波動性: ${(best.score * 100).toFixed(2)}%`);
                    
                    // 判斷是否切換
                    const improvementRatio = best.score / currentVolatility;
                    log(`📈 改善比率: ${improvementRatio.toFixed(2)}x (需要 > ${CONFIG.rotationImprovementThreshold}x)`);
                    
                    if (improvementRatio > CONFIG.rotationImprovementThreshold) {
                        log(`✅ 波動性改善 ${((improvementRatio - 1) * 100).toFixed(1)}%，觸發輪動！`);
                        await rotateSymbol(best.symbol);
                        continue; 
                    } else {
                        log(`⏸️ 改善幅度不足，保持當前幣種`);
                    }
                } else {
                    log(`✅ 當前幣種已是最佳選擇`);
                }
            }

            // 2. 破網檢查
            if (price > gridState.upperPrice || price < gridState.lowerPrice) {
                if (CONFIG.autoRebalance) {
                    if (Date.now() - gridState.lastRebalanceTime > CONFIG.rebalanceCooldown) {
                        log(`🔄 破網重置...`);
                        await initializeGrid();
                    }
                }
            }

            // 3. 補單邏輯 (實盤)
            if (!CONFIG.simMode) {
                const openOrders = await exchange.fetchOpenOrders(CONFIG.symbol);
                const openOrderIds = new Set(openOrders.map(o => o.id));
                
                // 計算目前總持倉名義價值，避免超過投資上限
                async function getTotalPositionNotional(symbol) {
                    try {
                        const positions = await exchange.fetchPositions([symbol]);
                        let total = 0;
                        for (const pos of positions) {
                            total += Math.abs(parseFloat(pos.notional) || 0);
                        }
                        return total;
                    } catch (e) {
                        log(`獲取持倉總量失敗: ${e.message}`);
                        return 0;
                    }
                }

                for (let order of gridState.orders) {
                    if (order.status === 'open' && !openOrderIds.has(order.id)) {
                        log(`✅ [成交] ${order.side} @ ${order.price}`);
                        order.status = 'filled';

                        // 補單前檢查總持倉是否超過投資上限
                        const totalNotional = await getTotalPositionNotional(CONFIG.symbol);
                        const maxNotional = CONFIG.investment * CONFIG.leverage;
                        if (totalNotional >= maxNotional) {
                            log(`⚠️ 總持倉 ${totalNotional.toFixed(2)}U 已達上限 ${maxNotional}U，跳過補單`);
                            continue;
                        }

                        const newSide = order.side === 'buy' ? 'sell' : 'buy';
                        const newPrice = order.side === 'buy' ? order.price + gridState.gridStep : order.price - gridState.gridStep;

                        const notionalPerGrid = (CONFIG.investment * CONFIG.leverage * 0.8) / CONFIG.gridCount;
                        let newAmount = notionalPerGrid / newPrice;

                        // 使用交易所精度
                        try {
                            newAmount = exchange.amountToPrecision(CONFIG.symbol, newAmount);
                        } catch (e) {
                            newAmount = Math.floor(newAmount);
                        }

                        if (newAmount === 0 || newAmount < 1) continue;

                        try {
                            const params = { 'timeInForce': 'GTX' };
                            const newOrder = await exchange.createOrder(CONFIG.symbol, 'limit', newSide, newAmount, newPrice, params);

                            gridState.orders.push({ id: newOrder.id, price: newPrice, side: newSide, status: 'open' });
                            log(`🔄 [補單] ${newSide} @ ${newPrice.toFixed(4)} (量: ${newAmount}) | 總持倉: ${totalNotional.toFixed(2)}U / ${maxNotional}U`);
                            notifyUser(`💰 網格成交！補單 ${newSide} @ ${newPrice.toFixed(4)}`);
                            dailyStats.tradeCount++;
                        } catch (e) {
                            log(`補單失敗: ${e.message}`);
                            if (e.message && e.message.includes('Margin is insufficient')) {
                                log(`⚠️ 補單時保證金不足，跳過此補單`);
                            }
                        }
                    }
                }
                gridState.orders = gridState.orders.filter(o => o.status === 'open');
            }

        } catch (e) {
            log(`監控錯誤: ${e.message}`);
        }
        
        await new Promise(r => setTimeout(r, CONFIG.checkInterval));
    }
}

logExchangeInfo();
log('🚀 網格機器人 3.2 (多交易所支援) 啟動...');
monitorGrid();

