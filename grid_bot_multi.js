import ccxt from 'ccxt';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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
    simMode: false           
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
    lastRotationTime: 0,          // 記錄最後一次輪動的時間
    entryEquity: CONFIG.investment
};

function log(msg) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${msg}`);
}

function notifyUser(message) {
    // Has been corrected: Use the correct Telegram Target ID
    // Using log for now to avoid exec issues, usually main agent handles messaging
    log(`Notification content: ${message}`); 
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
        
        // 檢查成交量（如果有配置）
        if (CONFIG.minVolumeForRotation && item.volume_4h) {
            return item.volume_4h > CONFIG.minVolumeForRotation;
        }
        return true;
    });

    if (validCandidates.length === 0) {
        log("❌ 沒有符合條件的幣種，保持當前幣種。");
        return { symbol: CONFIG.symbol, score: 0 };
    }

    // 計算或獲取波動性分數
    for (let item of validCandidates) {
        if (!item.volatilityScore || item.volatilityScore === 0) {
            // 如果沒有波動性分數，實時計算
            const score = await getVolatilityScore(item.symbol);
            item.volatilityScore = score;
        }
    }

    // 找出波動性最高的幣種
    const bestCandidate = validCandidates.reduce((prev, current) => {
        const prevScore = typeof prev.volatilityScore === 'number' ? prev.volatilityScore : 0;
        const currentScore = typeof current.volatilityScore === 'number' ? current.volatilityScore : 0;
        return (prevScore > currentScore) ? prev : current;
    }, { symbol: CONFIG.symbol, volatilityScore: 0 });

    log(`✅ 最佳幣種: ${bestCandidate.symbol} (波動性分數: ${(bestCandidate.volatilityScore * 100).toFixed(2)}%)`);
    log(`📊 當前幣種: ${CONFIG.symbol} 的波動性將在切換前重新評估`);
    
    return { symbol: bestCandidate.symbol, score: bestCandidate.volatilityScore };
}

async function closeAllPositions(symbol) {
    if (CONFIG.simMode) return;
    try {
        log(`🗑️ 取消 ${symbol} 的所有掛單...`);
        await exchange.cancelAllOrders(symbol);

        log(`📊 檢查 ${symbol} 的持倉...`);
        const positions = await exchange.fetchPositions([symbol]);
        for (const pos of positions) {
            const contracts = parseFloat(pos.contracts);
            if (contracts > 0) {
                const side = pos.side === 'long' ? 'sell' : 'buy';
                log(`🔄 平倉 ${pos.side} 倉位: ${contracts} 張`);
                await exchange.createOrder(symbol, 'market', side, contracts, undefined, { reduceOnly: true });
            }
        }
        log(`✅ ${symbol} 已完全平倉`);
    } catch (e) {
        log(`❌ 平倉失敗: ${e.message}`);
    }
}

async function initializeGrid() {
    try {
        let currentSymbol = CONFIG.symbol;

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

        if (CONFIG.useAtrGrid) {
            const atr = await getATR(currentSymbol, CONFIG.atrPeriod);
            gridStep = atr * CONFIG.atrMultiplier;
        } else {
            gridStep = currentPrice * 0.01; 
        }

        const range = gridStep * CONFIG.gridCount;
        const upperPrice = currentPrice + (range / 2);
        const lowerPrice = currentPrice - (range / 2);

        log(`=== 初始化網格 [${currentSymbol}] ===`);
        log(`區間: ${lowerPrice.toFixed(4)} - ${upperPrice.toFixed(4)}`);
        log(`格距: ${gridStep.toFixed(4)} | 格數: ${CONFIG.gridCount}`);

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

async function monitorGrid() {
    if (!gridState.isActive) await initializeGrid();

    while (true) {
        try {
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

