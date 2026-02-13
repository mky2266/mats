import ccxt from 'ccxt';
import { EMA, ATR, ADX, RSI, SMA } from 'technicalindicators';
import dotenv from 'dotenv';
import * as fs from 'fs'; 
import path from 'path';
import { fileURLToPath } from 'url';
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

// === 多幣種趨勢策略 (Multi-Exchange Support) ===
const CONFIG = {
    // 交易設定
    maxPositions: 2,
    investmentPerTrade: 15,
    leverage: 1,
    checkInterval: 60000 * 60 * 4,
    
    // 篩選設定
    marketDataFile: 'market_data.json',
    
    // 策略參數
    timeframe: '4h',  // 會自動轉換為各交易所格式
    emaFastPeriod: 9,
    emaSlowPeriod: 21,
    adxPeriod: 14,
    adxThreshold: 25,
    atrPeriod: 14,
    rsiPeriod: 14,
    volSmaPeriod: 20,
    
    // 風險管理
    slAtrMultiplier: 2.0,
    trailStartAtr: 1.0,
    trailStepAtr: 0.5
};

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

// 持倉狀態
let activePositions = {}; 
const STATE_FILE = `bot_state_${EXCHANGE_NAME}.json`;

// 可交易幣種快取
let tradableSymbolsCache = new Set();
let lastCacheUpdate = 0;
const CACHE_DURATION = 60000 * 60;

function log(msg) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${msg}`);
}

function saveState() {
    try {
        const stateToSave = { activePositions };
        fs.writeFileSync(STATE_FILE, JSON.stringify(stateToSave, null, 2));
        log(`狀態已儲存至 ${STATE_FILE}`);
    } catch (e) {
        log(`儲存狀態失敗: ${e.message}`);
    }
}

function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const stateData = fs.readFileSync(STATE_FILE, 'utf8');
            const loadedState = JSON.parse(stateData);
            activePositions = loadedState.activePositions || {};
            log(`已載入 ${Object.keys(activePositions).length} 個持倉狀態`);
            return true;
        } else {
            log('狀態檔案不存在，初始化新狀態。');
            activePositions = {}; 
            return false;
        }
    } catch (e) {
        log(`載入狀態失敗: ${e.message}`);
        activePositions = {}; 
        return false;
    }
}

async function updateTradableSymbolsCache() {
    const now = Date.now();
    if (now - lastCacheUpdate < CACHE_DURATION && tradableSymbolsCache.size > 0) {
        return tradableSymbolsCache;
    }

    try {
        await exchange.loadMarkets();
        const markets = exchange.markets;
        const config = getExchangeConfig();
        
        tradableSymbolsCache = new Set(
            Object.keys(markets).filter(symbol => {
                const market = markets[symbol];
                
                let isValid = market.active && market.quote === 'USDT';
                
                if (EXCHANGE_NAME === 'binance') {
                    isValid = isValid && market.type === 'future' &&
                        (!market.info.contractType || market.info.contractType === 'PERPETUAL');
                } else {
                    isValid = isValid && (market.type === 'swap' || market.linear === true);
                }
                
                return isValid;
            })
        );
        
        lastCacheUpdate = now;
        log(`已更新可交易幣種快取，共 ${tradableSymbolsCache.size} 個幣種`);
        return tradableSymbolsCache;
    } catch (e) {
        log(`更新可交易幣種快取失敗: ${e.message}`);
        return tradableSymbolsCache;
    }
}

async function isSymbolTradable(symbol) {
    const tradableSymbols = await updateTradableSymbolsCache();
    return tradableSymbols.has(symbol);
}

async function getUsdtBalance() {
    try {
        const balance = await exchange.fetchBalance();
        return balance.total['USDT'] || 0;
    } catch (e) {
        log(`獲取餘額失敗: ${e.message}`);
        return 0;
    }
}

async function getTargetSymbols() {
    try {
        const marketDataPath = path.join(__dirname, CONFIG.marketDataFile);
        if (!fs.existsSync(marketDataPath)) {
            log(`警告：找不到 ${CONFIG.marketDataFile}`);
            return [];
        }

        const data = fs.readFileSync(marketDataPath, 'utf8');
        const marketData = JSON.parse(data);

        const symbols = marketData.map(item => normalizeSymbol(item.symbol));
        
        const tradableSymbols = await updateTradableSymbolsCache();
        const validSymbols = symbols.filter(sym => tradableSymbols.has(sym));
        
        if (validSymbols.length < symbols.length) {
            log(`已過濾掉 ${symbols.length - validSymbols.length} 個不可交易的幣種`);
        }
        
        log(`從 ${CONFIG.marketDataFile} 讀取了 ${validSymbols.length} 個可交易標的。`);
        return validSymbols;

    } catch (e) {
        log(`讀取市場數據失敗: ${e.message}`);
        return [];
    }
}

async function analyzeSymbol(symbol) {
    try {
        const isTradable = await isSymbolTradable(symbol);
        if (!isTradable) {
            log(`⚠️ ${symbol} 不可交易，跳過分析`);
            return;
        }

        if (activePositions[symbol]) {
            await managePosition(symbol);
            return;
        }

        if (Object.keys(activePositions).length >= CONFIG.maxPositions) {
            return;
        }

        const timeframe = normalizeTimeframe(CONFIG.timeframe);
        const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, undefined, 100);
        
        if (!ohlcv || ohlcv.length < 50) {
            log(`${symbol} OHLCV 數據不足`);
            return;
        }

        const highs = ohlcv.map(c => c[2]);
        const lows = ohlcv.map(c => c[3]);
        const closes = ohlcv.map(c => c[4]);
        const volumes = ohlcv.map(c => c[5]);
        
        const lastPrice = closes[closes.length - 1];
        const lastVolume = volumes[volumes.length - 1];

        const emaFast = EMA.calculate({ period: CONFIG.emaFastPeriod, values: closes });
        const emaSlow = EMA.calculate({ period: CONFIG.emaSlowPeriod, values: closes });
        const atr = ATR.calculate({ high: highs, low: lows, close: closes, period: CONFIG.atrPeriod });
        const adx = ADX.calculate({ high: highs, low: lows, close: closes, period: CONFIG.adxPeriod });
        const rsi = RSI.calculate({ period: CONFIG.rsiPeriod, values: closes });
        const volSma = SMA.calculate({ period: CONFIG.volSmaPeriod, values: volumes });

        const curFast = emaFast[emaFast.length - 1];
        const prevFast = emaFast[emaFast.length - 2];
        const curSlow = emaSlow[emaSlow.length - 1];
        const prevSlow = emaSlow[emaSlow.length - 2];
        const curAdx = adx[adx.length - 1];
        const curAtr = atr[atr.length - 1];
        const curRsi = rsi[rsi.length - 1];
        const curVolSma = volSma[volSma.length - 1];

        if (!curFast || !curSlow || !curAdx || !curAtr || !curRsi || !curVolSma) {
            log(`${symbol} 指標計算不完整`);
            return;
        }

        if (curAdx.adx > CONFIG.adxThreshold && lastVolume > curVolSma) {
            if (prevFast <= prevSlow && curFast > curSlow && curRsi < 70) {
                await openPosition(symbol, 'long', lastPrice, curAtr);
            }
            else if (prevFast >= prevSlow && curFast < curSlow && curRsi > 30) {
                await openPosition(symbol, 'short', lastPrice, curAtr);
            }
        }

    } catch (e) {
        log(`分析 ${symbol} 錯誤: ${e.message}`);
    }
}

async function openPosition(symbol, side, price, atr) {
    try {
        const isTradable = await isSymbolTradable(symbol);
        if (!isTradable) {
            log(`❌ ${symbol} 不可交易，取消開倉`);
            return;
        }

        const balance = await getUsdtBalance();
        if (balance < CONFIG.investmentPerTrade) {
            log(`餘額不足 (${balance.toFixed(2)} U) 開倉 ${symbol}`);
            return;
        }

        const amount = (CONFIG.investmentPerTrade * CONFIG.leverage) / price;
        
        let sl;
        if (side === 'long') {
            sl = price - (atr * CONFIG.slAtrMultiplier);
        } else {
            sl = price + (atr * CONFIG.slAtrMultiplier);
        }

        log(`🚀 開倉: ${side.toUpperCase()} ${symbol} @ ${price}`);
        
        await exchange.setLeverage(CONFIG.leverage, symbol);
        const orderSide = side === 'long' ? 'buy' : 'sell';
        await exchange.createOrder(symbol, 'market', orderSide, amount);
        
        activePositions[symbol] = { 
            side, 
            entryPrice: price, 
            amount, 
            slPrice: sl, 
            highestPrice: price,
            lowestPrice: price,
            atr: atr,
            isTrailing: false
        };
        
        log(`🚀 【趨勢進場】${side === 'long' ? '做多' : '做空'} ${symbol}\n價格: ${price}\n初始止損: ${sl.toFixed(4)}`);
        saveState();
    } catch (e) {
        log(`下單失敗 ${symbol}: ${e.message}`);
    }
}

async function managePosition(symbol) {
    const pos = activePositions[symbol];
    if (!pos) return;

    try {
        const isTradable = await isSymbolTradable(symbol);
        if (!isTradable) {
            log(`⚠️ ${symbol} 已不可交易，強制平倉`);
            await forceClosePosition(symbol, '市場停止交易');
            return;
        }

        const ticker = await exchange.fetchTicker(symbol);
        const price = ticker.last;
        let closeType = null;

        if (price > pos.highestPrice) pos.highestPrice = price;
        if (price < pos.lowestPrice) pos.lowestPrice = price;

        if (pos.side === 'long') {
            if (price <= pos.slPrice) {
                closeType = 'SL';
            } 
            else {
                if (!pos.isTrailing && price >= pos.entryPrice + (pos.atr * CONFIG.trailStartAtr)) {
                    pos.slPrice = pos.entryPrice;
                    pos.isTrailing = true;
                    log(`🛡️ ${symbol} 移動止損至保本 @ ${pos.slPrice}`);
                }
                else if (pos.isTrailing) {
                    const newSl = pos.highestPrice - (pos.atr * CONFIG.slAtrMultiplier);
                    if (newSl > pos.slPrice) {
                        pos.slPrice = newSl;
                        log(`📈 ${symbol} 上調止損至 @ ${pos.slPrice}`);
                    }
                }
            }
        } else {
            if (price >= pos.slPrice) {
                closeType = 'SL';
            }
            else {
                if (!pos.isTrailing && price <= pos.entryPrice - (pos.atr * CONFIG.trailStartAtr)) {
                    pos.slPrice = pos.entryPrice;
                    pos.isTrailing = true;
                    log(`🛡️ ${symbol} 移動止損至保本 @ ${pos.slPrice}`);
                }
                else if (pos.isTrailing) {
                    const newSl = pos.lowestPrice + (pos.atr * CONFIG.slAtrMultiplier);
                    if (newSl < pos.slPrice) {
                        pos.slPrice = newSl;
                        log(`📉 ${symbol} 下調止損至 @ ${pos.slPrice}`);
                    }
                }
            }
        }

        if (closeType) {
            await closePosition(symbol, closeType, price);
        }
    } catch (e) {
        log(`管理持倉失敗 ${symbol}: ${e.message}`);
    }
}

async function closePosition(symbol, closeType, price) {
    const pos = activePositions[symbol];
    if (!pos) return;

    try {
        log(`🛑 平倉 ${symbol}: ${closeType} @ ${price}`);
        const side = pos.side === 'long' ? 'sell' : 'buy';
        await exchange.createOrder(symbol, 'market', side, pos.amount, undefined, { reduceOnly: true });
        
        const pnl = pos.side === 'long' ? (price - pos.entryPrice) : (pos.entryPrice - price);
        const pnlPercent = (pnl / pos.entryPrice) * 100 * CONFIG.leverage;

        log(`🛑 【出場】${symbol} (${closeType})\n價格: ${price}\n損益: ${pnlPercent.toFixed(2)}%`);
        delete activePositions[symbol];
        saveState();
    } catch (e) {
        log(`平倉失敗 ${symbol}: ${e.message}`);
    }
}

async function forceClosePosition(symbol, reason) {
    const pos = activePositions[symbol];
    if (!pos) return;

    try {
        const ticker = await exchange.fetchTicker(symbol);
        const price = ticker.last;
        await closePosition(symbol, reason, price);
    } catch (e) {
        log(`強制平倉失敗 ${symbol}: ${e.message}`);
        delete activePositions[symbol];
        saveState();
    }
}

async function runBot() {
    logExchangeInfo();
    log(`🚀 多幣種趨勢機器人 V3.0 (Multi-Exchange Support) 啟動`);
    
    loadState();
    await updateTradableSymbolsCache();

    log('🤖 趨勢機器人已上線\n狀態已載入，繼續運行。');
    
    while (true) {
        try {
            const symbols = await getTargetSymbols();
            
            if (symbols.length === 0) {
                log('⚠️ 沒有獲取到標的，可能是 market_scanner.js 尚未運行。休眠後重試。');
            } else {
                log(`🔍 掃描 ${symbols.length} 個來自市場掃描的幣種...`);
                
                for (const sym of symbols) {
                    await analyzeSymbol(sym);
                    await new Promise(r => setTimeout(r, 1000));
                }
        
                log(`--- 本輪掃描結束，目前持倉: ${Object.keys(activePositions).length}/${CONFIG.maxPositions} ---`);
                saveState();
            }
        } catch (e) {
            log(`❌ 主循環錯誤: ${e.message}`);
            log(`將在下個循環繼續運行...`);
        }
        
        await new Promise(r => setTimeout(r, CONFIG.checkInterval));
    }
}

runBot();
