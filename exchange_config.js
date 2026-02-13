// exchange_config.js - 多交易所配置檔
import dotenv from 'dotenv';
dotenv.config();

// ========== 選擇交易所 ==========
// 可選值: 'binance', 'bybit', 'okx', 'bitget', 'pionex'
export const EXCHANGE_NAME = 'binance';  // ← 在這裡切換交易所

// ========== 交易所配置 ==========
export const EXCHANGE_CONFIGS = {
    binance: {
        id: 'binance',
        apiKey: process.env.BINANCE_API_KEY,
        secret: process.env.BINANCE_SECRET,
        enableRateLimit: true,
        options: { 
            defaultType: 'future',  // Binance 使用 'future'
        },
        // Binance 專用設定
        timeframe: '4h',
        marketType: 'future',
        symbolFormat: 'BTC/USDT:USDT',
    },
    
    bybit: {
        id: 'bybit',
        apiKey: process.env.BYBIT_API_KEY,
        secret: process.env.BYBIT_SECRET,
        enableRateLimit: true,
        options: { 
            defaultType: 'swap',    // Bybit 使用 'swap'
        },
        // Bybit 專用設定
        timeframe: '240',           // Bybit 使用數字表示（240 = 4h）
        marketType: 'swap',
        symbolFormat: 'BTC/USDT:USDT',
    },
    
    okx: {
        id: 'okx',
        apiKey: process.env.OKX_API_KEY,
        secret: process.env.OKX_SECRET,
        password: process.env.OKX_PASSWORD,  // OKX 需要 password
        enableRateLimit: true,
        options: { 
            defaultType: 'swap',
        },
        // OKX 專用設定
        timeframe: '4H',            // OKX 使用大寫 H
        marketType: 'swap',
        symbolFormat: 'BTC/USDT:USDT',
    },
    
    bitget: {
        id: 'bitget',
        apiKey: process.env.BITGET_API_KEY,
        secret: process.env.BITGET_SECRET,
        password: process.env.BITGET_PASSWORD,  // Bitget 需要 password
        enableRateLimit: true,
        options: { 
            defaultType: 'swap',
        },
        // Bitget 專用設定
        timeframe: '4h',
        marketType: 'swap',
        symbolFormat: 'BTC/USDT:USDT',
    },
    
    pionex: {
        id: 'pionex',
        apiKey: process.env.PIONEX_API_KEY,
        secret: process.env.PIONEX_SECRET,
        enableRateLimit: true,
        options: { 
            defaultType: 'swap',  // 派網使用 swap
        },
        // 派網專用設定
        timeframe: '4h',
        marketType: 'swap',
        symbolFormat: 'BTC/USDT:USDT',
        // 派網特殊設定
        rateLimit: 1200,  // 派網 API 限制較嚴格
    },
};

// ========== 獲取當前交易所配置 ==========
export function getExchangeConfig() {
    const config = EXCHANGE_CONFIGS[EXCHANGE_NAME];
    if (!config) {
        throw new Error(`不支援的交易所: ${EXCHANGE_NAME}`);
    }
    return config;
}

// ========== 驗證 API 金鑰 ==========
export function validateApiKeys() {
    const config = getExchangeConfig();
    
    if (!config.apiKey || !config.secret) {
        throw new Error(`❌ 請在 .env 檔案中設定 ${EXCHANGE_NAME.toUpperCase()}_API_KEY 和 ${EXCHANGE_NAME.toUpperCase()}_SECRET`);
    }
    
    // 檢查 OKX 和 Bitget 的 password
    if ((EXCHANGE_NAME === 'okx' || EXCHANGE_NAME === 'bitget') && !config.password) {
        throw new Error(`❌ ${EXCHANGE_NAME.toUpperCase()} 需要設定 ${EXCHANGE_NAME.toUpperCase()}_PASSWORD`);
    }
    
    return true;
}

// ========== 符號格式轉換 ==========
export function normalizeSymbol(symbol) {
    // 統一符號格式為 BTC/USDT:USDT
    if (!symbol.includes('/')) {
        // BTCUSDT -> BTC/USDT:USDT
        const base = symbol.replace('USDT', '');
        return `${base}/USDT:USDT`;
    }
    
    if (!symbol.includes(':')) {
        // BTC/USDT -> BTC/USDT:USDT
        return `${symbol}:USDT`;
    }
    
    return symbol;
}

// ========== 時間框架轉換 ==========
export function normalizeTimeframe(timeframe) {
    const config = getExchangeConfig();
    
    // 統一輸入格式為 '4h'
    const standardTimeframe = timeframe.toLowerCase();
    
    // 根據交易所轉換
    switch (EXCHANGE_NAME) {
        case 'binance':
        case 'bitget':
            return standardTimeframe;  // '4h'
            
        case 'bybit':
            // 轉換為分鐘數
            const timeframeMap = {
                '1m': '1', '3m': '3', '5m': '5', '15m': '15', 
                '30m': '30', '1h': '60', '2h': '120', '4h': '240',
                '6h': '360', '12h': '720', '1d': 'D', '1w': 'W'
            };
            return timeframeMap[standardTimeframe] || '240';
            
        case 'okx':
            // 使用大寫
            return standardTimeframe.toUpperCase();  // '4H'
            
        default:
            return standardTimeframe;
    }
}

// ========== 日誌輸出 ==========
export function logExchangeInfo() {
    console.log('='.repeat(60));
    console.log(`📊 當前交易所: ${EXCHANGE_NAME.toUpperCase()}`);
    console.log(`🔧 市場類型: ${getExchangeConfig().marketType}`);
    console.log(`⏰ 時間框架格式: ${getExchangeConfig().timeframe}`);
    console.log('='.repeat(60));
}
