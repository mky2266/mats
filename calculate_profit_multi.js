import ccxt from 'ccxt';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { 
    EXCHANGE_NAME, 
    getExchangeConfig, 
    validateApiKeys,
    logExchangeInfo
} from './exchange_config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

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

// 配置
const CONFIG = {
    initialInvestment: 180,

    additionalDeposits: [
        // { date: '2026-02-18', amount: 100 },
    ],

    startDate: '2026-02-07',  // 機器人開始運行日期
    symbols: [],
};

function log(msg) {
    console.log(msg);
}

function getTotalInvestment() {
    let total = CONFIG.initialInvestment;
    
    if (CONFIG.additionalDeposits && CONFIG.additionalDeposits.length > 0) {
        for (const deposit of CONFIG.additionalDeposits) {
            total += deposit.amount;
        }
    }
    
    return total;
}

async function getTotalBalance() {
    try {
        const balance = await exchange.fetchBalance();
        const total = balance.total['USDT'] || 0;
        const free = balance.free['USDT'] || 0;
        const used = balance.used['USDT'] || 0;
        
        return { total, free, used };
    } catch (e) {
        log(`獲取餘額失敗: ${e.message}`);
        return null;
    }
}

async function getRealizedPnL(symbol = null, startTime = null) {
    try {
        const params = {};
        if (symbol) params.symbol = symbol.replace('/', '').replace(':USDT', '');
        if (startTime) params.startTime = startTime;
        
        let trades;
        
        // 不同交易所的 API 方法可能不同
        if (EXCHANGE_NAME === 'binance') {
            trades = await exchange.fapiPrivateGetUserTrades(params);
        } else if (EXCHANGE_NAME === 'bybit') {
            const response = await exchange.privateGetV5ExecutionList(params);
            trades = response.result.list || [];
        } else if (EXCHANGE_NAME === 'okx') {
            const response = await exchange.privateGetTradeFillsHistory(params);
            trades = response.data || [];
        } else {
            // 使用通用方法
            trades = await exchange.fetchMyTrades(symbol, startTime);
        }
        
        let totalPnL = 0;
        let tradeCount = 0;
        const symbolStats = {};
        
        for (const trade of trades) {
            const realizedPnl = parseFloat(trade.realizedPnl || trade.profit || 0);
            totalPnL += realizedPnl;
            tradeCount++;
            
            const sym = trade.symbol || symbol;
            if (!symbolStats[sym]) {
                symbolStats[sym] = {
                    pnl: 0,
                    trades: 0,
                    commission: 0
                };
            }
            symbolStats[sym].pnl += realizedPnl;
            symbolStats[sym].trades++;
            symbolStats[sym].commission += parseFloat(trade.commission || trade.fee || 0);
        }
        
        // 計算總手續費
    let totalCommission = 0;
    for (const stats of Object.values(symbolStats)) {
        totalCommission += stats.commission;
    }

    return { totalPnL, tradeCount, symbolStats, totalCommission };
    } catch (e) {
        log(`獲取盈虧失敗: ${e.message}`);
        log(`提示: ${EXCHANGE_NAME} 交易所可能需要特殊處理`);
        return null;
    }
}

async function getUnrealizedPnL() {
    try {
        const positions = await exchange.fetchPositions();
        let totalUnrealized = 0;
        for (const pos of positions) {
            const unrealized = parseFloat(pos.unrealizedPnl || pos.unrealisedPnl || 0);
            totalUnrealized += unrealized;
        }
        return totalUnrealized;
    } catch (e) {
        log(`獲取未實現盈虧失敗: ${e.message}`);
        return 0;
    }
}

function getRunningDays() {
    if (!CONFIG.startDate) return 1;
    const start = new Date(CONFIG.startDate);
    const now = new Date();
    const diff = Math.floor((now - start) / (1000 * 60 * 60 * 24));
    return diff > 0 ? diff : 1;
}

function calculateROI(profit, investment) {
    return (profit / investment) * 100;
}

function calculateAPY(profit, investment, days) {
    const dailyReturn = profit / investment / days;
    const apy = ((Math.pow(1 + dailyReturn, 365) - 1) * 100);
    return apy;
}

async function analyzeProfit() {
    logExchangeInfo();
    log('='.repeat(60));
    log('📊 網格機器人收益分析工具');
    log('='.repeat(60));
    log('');
    
    log('💰 查詢帳戶資產...');
    const balance = await getTotalBalance();
    
    if (balance) {
        log(`總資產: ${balance.total.toFixed(2)} USDT`);
        log(`可用: ${balance.free.toFixed(2)} USDT`);
        log(`占用: ${balance.used.toFixed(2)} USDT`);
        log('');
    }
    
    const totalInvestment = getTotalInvestment();
    const totalProfit = balance ? balance.total - totalInvestment : 0;
    const roi = balance ? calculateROI(totalProfit, totalInvestment) : 0;
    
    log('💵 總體收益:');
    log(`初始投入: ${CONFIG.initialInvestment.toFixed(2)} USDT`);
    
    if (CONFIG.additionalDeposits && CONFIG.additionalDeposits.length > 0) {
        log(`追加資金:`);
        for (const deposit of CONFIG.additionalDeposits) {
            log(`  - ${deposit.date}: +${deposit.amount.toFixed(2)} USDT`);
        }
        log(`總投入: ${totalInvestment.toFixed(2)} USDT`);
    }
    
    log(`當前總資產: ${balance ? balance.total.toFixed(2) : 'N/A'} USDT`);
    log(`總收益: ${totalProfit > 0 ? '+' : ''}${totalProfit.toFixed(2)} USDT`);
    log(`收益率: ${roi > 0 ? '+' : ''}${roi.toFixed(2)}%`);
    log('');
    
    // 未實現盈虧
    const unrealizedPnL = await getUnrealizedPnL();
    if (unrealizedPnL !== 0) {
        log(`未實現盈虧: ${unrealizedPnL > 0 ? '+' : ''}${unrealizedPnL.toFixed(2)} USDT`);
        log('');
    }

    log('📈 查詢交易記錄...');
    const pnlData = await getRealizedPnL();

    if (pnlData) {
        log(`已實現盈虧: ${pnlData.totalPnL > 0 ? '+' : ''}${pnlData.totalPnL.toFixed(2)} USDT`);
        log(`總手續費: -${pnlData.totalCommission.toFixed(4)} USDT`);
        const netPnL = pnlData.totalPnL - pnlData.totalCommission;
        log(`淨盈虧（扣手續費）: ${netPnL > 0 ? '+' : ''}${netPnL.toFixed(2)} USDT`);
        log(`成交次數: ${pnlData.tradeCount} 次`);

        if (pnlData.tradeCount > 0) {
            const avgProfit = pnlData.totalPnL / pnlData.tradeCount;
            log(`平均每次: ${avgProfit > 0 ? '+' : ''}${avgProfit.toFixed(4)} USDT`);
        }
        log('');

        if (Object.keys(pnlData.symbolStats).length > 0) {
            log('📊 各幣種收益統計:');
            log('-'.repeat(60));

            const sortedSymbols = Object.entries(pnlData.symbolStats)
                .sort((a, b) => b[1].pnl - a[1].pnl);

            for (const [symbol, stats] of sortedSymbols) {
                const avgPnl = stats.pnl / stats.trades;
                const netPnl = stats.pnl - stats.commission;
                log(`${symbol.padEnd(12)} | 收益: ${stats.pnl > 0 ? '+' : ''}${stats.pnl.toFixed(2)} USDT | 手續費: -${stats.commission.toFixed(4)} | 淨: ${netPnl > 0 ? '+' : ''}${netPnl.toFixed(2)} | 次數: ${stats.trades} | 均: ${avgPnl.toFixed(4)}`);
            }
            log('');
        }
    }

    log('📅 收益率估算:');
    const runningDays = getRunningDays();  // 自動計算運行天數

    if (totalProfit !== 0 && runningDays > 0) {
        const dailyProfit = totalProfit / runningDays;
        const dailyROI = calculateROI(dailyProfit, totalInvestment);
        const apy = calculateAPY(totalProfit, totalInvestment, runningDays);

        log(`開始日期: ${CONFIG.startDate}`);
        log(`運行天數: ${runningDays} 天`);
        log(`日均收益: ${dailyProfit > 0 ? '+' : ''}${dailyProfit.toFixed(2)} USDT`);
        log(`日收益率: ${dailyROI.toFixed(2)}%`);
        log(`年化收益率 (APY): ${apy.toFixed(2)}%`);
    } else {
        log(`開始日期: ${CONFIG.startDate || '未設定'}`);
        log(`運行天數: ${runningDays} 天`);
        log('尚無收益數據');
    }
    
    log('');
    log('='.repeat(60));
    log('✅ 分析完成');
    log('='.repeat(60));
}

analyzeProfit().catch(err => {
    log(`錯誤: ${err.message}`);
    process.exit(1);
});
