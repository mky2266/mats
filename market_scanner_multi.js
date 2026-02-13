import ccxt from 'ccxt';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { 
    EXCHANGE_NAME, 
    getExchangeConfig, 
    validateApiKeys, 
    normalizeSymbol,
    normalizeTimeframe,
    logExchangeInfo
} from './exchange_config.js';

dotenv.config();

const CONFIG = {
    symbolSuffix: ':USDT',
    timeframe: '4h',
    topN: 20,
    outputFile: 'market_data.json',
    scanInterval: 60000 * 60 * 12,
};

// ========== 初始化交易所 ==========
function initExchange() {
    validateApiKeys();
    const config = getExchangeConfig();
    
    // 創建交易所實例
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
    
    // OKX 和 Bitget 需要 password
    if (config.password) {
        exchangeConfig.password = config.password;
    }
    
    return new ExchangeClass(exchangeConfig);
}

const exchange = initExchange();

async function log(msg) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${msg}`);
}

async function getTradableSymbols() {
    try {
        await exchange.loadMarkets();
        const markets = exchange.markets;
        const config = getExchangeConfig();
        
        const tradableSymbols = Object.keys(markets).filter(symbol => {
            const market = markets[symbol];
            
            // 根據交易所調整篩選條件
            let isValid = market.active && market.quote === 'USDT';
            
            if (EXCHANGE_NAME === 'binance') {
                isValid = isValid && market.type === 'future' &&
                    (!market.info.contractType || market.info.contractType === 'PERPETUAL');
            } else {
                // Bybit, OKX, Bitget 使用 swap
                isValid = isValid && (market.type === 'swap' || market.linear === true);
            }
            
            return isValid;
        });
        
        log(`找到 ${tradableSymbols.length} 個可交易的 USDT 永續合約`);
        return new Set(tradableSymbols);
    } catch (e) {
        log(`獲取可交易幣種列表失敗: ${e.message}`);
        return new Set();
    }
}

async function getTopCoinsByVolume(count = CONFIG.topN) {
    log(`正在獲取成交量前 ${count} 的幣種...`);
    try {
        const tradableSymbols = await getTradableSymbols();
        if (tradableSymbols.size === 0) {
            log('無法獲取可交易幣種列表');
            return [];
        }

        log(`正在獲取市場行情數據...`);
        const tickers = await exchange.fetchTickers();
        log(`獲取到 ${Object.keys(tickers).length} 個行情數據`);
        
        const usdtTickers = Object.values(tickers)
            .filter(t => {
                const hasUSDTQuote = t.symbol && t.symbol.includes('/USDT');
                const notLeveraged = t.symbol && 
                    !t.symbol.includes('UP/USDT') &&
                    !t.symbol.includes('DOWN/USDT') &&
                    !t.symbol.includes('BULL/USDT') &&
                    !t.symbol.includes('BEAR/USDT');
                const isTradable = t.symbol && tradableSymbols.has(t.symbol);
                
                return hasUSDTQuote && notLeveraged && isTradable;
            })
            .sort((a, b) => (b.quoteVolume || 0) - (a.quoteVolume || 0))
            .slice(0, count);
        
        log(`成功篩選出 ${usdtTickers.length} 個可交易幣種`);
        if (usdtTickers.length > 0) {
            log(`前5個幣種: ${usdtTickers.slice(0, 5).map(t => t.symbol).join(', ')}`);
        }
        return usdtTickers.map(t => t.symbol);
    } catch (e) {
        log(`獲取幣種失敗: ${e.message}`);
        log(`錯誤堆疊: ${e.stack}`);
        return [];
    }
}

async function calculateIndicators(symbol) {
    log(`正在獲取 ${symbol} 的數據...`);
    try {
        const timeframe = normalizeTimeframe(CONFIG.timeframe);
        const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, undefined, 30);
        
        if (!ohlcv || ohlcv.length < 2) {
            log(`${symbol} 的 OHLCV 數據不足，僅有 ${ohlcv?.length || 0} 筆`);
            return null;
        }

        const closes = ohlcv.map(c => c[4]);
        const volumes = ohlcv.map(c => c[5]);
        const timestamps = ohlcv.map(c => c[0]);

        const currentPrice = closes[closes.length - 1];
        const lastVolume = volumes[volumes.length - 1];
        const lastTimestamp = timestamps[timestamps.length - 1];

        return {
            symbol: symbol.replace(':USDT', '').replace('/', ''),
            price: currentPrice,
            volume_4h: lastVolume,
            timestamp: lastTimestamp
        };
    } catch (e) {
        log(`計算 ${symbol} 指標時出錯: ${e.message}`);
        return null;
    }
}

async function runMarketScanner() {
    logExchangeInfo();
    log("🚀 市場掃描器啟動（每 12 小時掃描一次）");
    
    while (true) {
        try {
            log("========================================");
            log("開始新一輪市場掃描...");
            
            const topSymbols = await getTopCoinsByVolume();
            if (topSymbols.length === 0) {
                log("無法獲取幣種列表，將在下次循環重試。");
            } else {
                const marketData = [];
                for (const symbol of topSymbols) {
                    const indicators = await calculateIndicators(symbol);
                    if (indicators) {
                        marketData.push(indicators);
                    }
                    await new Promise(r => setTimeout(r, 250)); 
                }

                marketData.sort((a, b) => b.volume_4h - a.volume_4h);

                const outputPath = path.join(process.cwd(), CONFIG.outputFile);
                fs.writeFileSync(outputPath, JSON.stringify(marketData, null, 2));
                log(`✅ 市場數據已儲存至 ${outputPath}`);
                log(`✅ 共掃描 ${marketData.length} 個幣種`);
            }
            
            const nextScanTime = new Date(Date.now() + CONFIG.scanInterval);
            log(`⏰ 下次掃描時間：${nextScanTime.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`);
            log("========================================");
            
            await new Promise(r => setTimeout(r, CONFIG.scanInterval));
            
        } catch (e) {
            log(`❌ 市場掃描器錯誤: ${e.message}`);
            log(`將在 1 分鐘後重試...`);
            await new Promise(r => setTimeout(r, 60000));
        }
    }
}

runMarketScanner();
