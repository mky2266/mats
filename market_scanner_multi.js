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
    scanInterval: 60000 * 60 * 12
};

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
        enableRateLimit: true,
        options: config.options
    };
    
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
        await exchange.loadMarkets(true);
        const markets = exchange.markets;
        
        const tradableSymbols = Object.keys(markets).filter(symbol => {
            const market = markets[symbol];
            
            if (!market.active || market.quote !== 'USDT') {
                return false;
            }
            
            if (symbol.includes('UP/') || symbol.includes('DOWN/') || 
                symbol.includes('BULL/') || symbol.includes('BEAR/')) {
                return false;
            }
            
            if (EXCHANGE_NAME === 'binance') {
                // 只取永續合約，排除季度交割合約
                const isSwapOrFuture = market.type === 'future' || market.type === 'swap';
                const hasUSDT = symbol.includes(':USDT');
                const isPerpetual = !market.info.contractType || market.info.contractType === 'PERPETUAL';
                return isSwapOrFuture && hasUSDT && isPerpetual;
            } else {
                return market.type === 'swap' || market.linear === true;
            }
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

        const tickers = await exchange.fetchTickers();
        
        const usdtTickers = Object.values(tickers)
            .filter(t => {
                if (!t.symbol) return false;
                if (!t.symbol.includes('/USDT')) return false;
                if (t.symbol.includes('UP/') || t.symbol.includes('DOWN/') ||
                    t.symbol.includes('BULL/') || t.symbol.includes('BEAR/')) return false;

                // 嘗試多種格式比對，適應不同交易所回傳的 ticker symbol 格式
                const symbolWithSuffix = t.symbol.includes(':USDT') ? t.symbol : `${t.symbol}:USDT`;
                const symbolWithoutSuffix = t.symbol.replace(':USDT', '');

                return tradableSymbols.has(t.symbol) ||
                       tradableSymbols.has(symbolWithSuffix) ||
                       tradableSymbols.has(symbolWithoutSuffix);
            })
            .sort((a, b) => (b.quoteVolume || 0) - (a.quoteVolume || 0))
            .slice(0, count);

        // 統一回傳格式為 tradableSymbols 中的格式（例如 BTC/USDT:USDT）
        return usdtTickers.map(t => {
            const symbolWithSuffix = t.symbol.includes(':USDT') ? t.symbol : `${t.symbol}:USDT`;
            if (tradableSymbols.has(symbolWithSuffix)) return symbolWithSuffix;
            if (tradableSymbols.has(t.symbol)) return t.symbol;
            return symbolWithSuffix;
        });
    } catch (e) {
        log(`獲取幣種失敗: ${e.message}`);
        return [];
    }
}

async function calculateIndicators(symbol) {
    try {
        const timeframe = normalizeTimeframe(CONFIG.timeframe);
        const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, undefined, 30);
        
        if (!ohlcv || ohlcv.length < 2) {
            return null;
        }

        const closes = ohlcv.map(c => c[4]);
        const volumes = ohlcv.map(c => c[5]);
        const timestamps = ohlcv.map(c => c[0]);

        return {
            symbol: symbol.replace(':USDT', '').replace('/', ''),
            price: closes[closes.length - 1],
            volume_4h: volumes[volumes.length - 1],
            timestamp: timestamps[timestamps.length - 1]
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
