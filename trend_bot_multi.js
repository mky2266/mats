/**
 * trend_bot_multi.js - 趨勢追蹤策略機器人
 *
 * 策略邏輯：
 * - EMA20 穿越 EMA50 → 判斷趨勢方向
 * - 趨勢向上（黃金交叉）→ 做多
 * - 趨勢向下（死亡交叉）→ 做空
 * - ATR 動態設定移動停損距離
 * - 風控三道防線（同 grid bot）
 */

import ccxt from 'ccxt';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EMA, ATR } from 'technicalindicators';
import {
    EXCHANGE_NAME,
    getExchangeConfig,
    validateApiKeys,
    normalizeSymbol,
    normalizeTimeframe,
    logExchangeInfo
} from './exchange_config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

// ========== 設定 ==========
const CONFIG = {
    investment: 90,             // 資金（建議為總資金的 50%，另 50% 給網格）
    leverage: 2,                // 槓桿倍數
    checkInterval: 60000 * 5,  // 每 5 分鐘檢查一次

    // EMA 設定
    emaFast: 20,                // 快線 EMA
    emaSlow: 50,                // 慢線 EMA
    timeframe: '4h',            // K 線時間框架

    // ATR 移動停損
    atrPeriod: 14,
    atrStopMultiplier: 2.0,    // 停損距離 = ATR × 2
    atrTpMultiplier: 3.0,      // 停利距離 = ATR × 3（風報比 1.5）

    // 風控設定
    stopLossEnabled: true,
    stopLossPercent: 0.15,      // 單次虧損超過 15% 停止
    dailyLossLimit: 0.20,       // 每日虧損超過 20% 暫停
    maxDrawdownPercent: 0.30,   // 最大回撤超過 30% 停止

    // 模式
    simMode: false,
};

// NanoClaw IPC 通知
const NANOCLAW_IPC_DIR = process.env.NANOCLAW_IPC_DIR || '/home/mky/nanoclaw/data/ipc/main/messages';
const NANOCLAW_CHAT_JID = process.env.NANOCLAW_CHAT_JID || '886915721620@s.whatsapp.net';

// ========== 狀態 ==========
let botState = {
    symbol: null,
    position: null,         // null | { side: 'long'|'short', entryPrice, amount, stopLoss, takeProfit }
    lastSignal: null,       // 'golden_cross' | 'death_cross' | null
    peakEquity: CONFIG.investment,
    dailyLoss: 0,
    dailyLossDate: '',
    entryEquity: CONFIG.investment,
    tradeCount: 0,
    lastReportDate: '',
};

// ========== 初始化交易所 ==========
function initExchange() {
    validateApiKeys();
    const config = getExchangeConfig();
    const ExchangeClass = ccxt[config.id];
    if (!ExchangeClass) throw new Error(`CCXT 不支援交易所: ${config.id}`);
    const exchangeConfig = {
        apiKey: config.apiKey,
        secret: config.secret,
        enableRateLimit: config.enableRateLimit,
        options: config.options,
    };
    if (config.password) exchangeConfig.password = config.password;
    return new ExchangeClass(exchangeConfig);
}

const exchange = initExchange();

// ========== 工具函數 ==========
function log(msg) {
    console.log(`[${new Date().toISOString()}] [TrendBot] ${msg}`);
}

function notifyUser(message) {
    log(`📢 通知: ${message}`);
    try {
        if (!fs.existsSync(NANOCLAW_IPC_DIR)) return;
        const payload = JSON.stringify({
            type: 'message',
            chatJid: NANOCLAW_CHAT_JID,
            text: `📈 *趨勢機器人*\n${message}`
        });
        const filename = path.join(NANOCLAW_IPC_DIR, `trend_${Date.now()}.json`);
        fs.writeFileSync(filename, payload, 'utf-8');
    } catch (e) {
        log(`⚠️ 無法發送通知: ${e.message}`);
    }
}

async function readMarketData() {
    try {
        const p = path.join(__dirname, 'market_data.json');
        if (!fs.existsSync(p)) return null;
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch (e) {
        return null;
    }
}

// ========== 選幣 ==========
async function selectSymbol() {
    const data = await readMarketData();
    if (!data || data.length === 0) {
        log('⚠️ market_data.json 無資料，等待市場掃描...');
        return null;
    }
    // 選波動性最高的幣種
    const best = data.reduce((prev, curr) => {
        const ps = typeof prev.volatilityScore === 'number' ? prev.volatilityScore : 0;
        const cs = typeof curr.volatilityScore === 'number' ? curr.volatilityScore : 0;
        return cs > ps ? curr : prev;
    }, data[0]);

    let symbol = best.symbol;
    if (!symbol.includes('/') && symbol.endsWith('USDT')) {
        symbol = `${symbol.replace('USDT', '')}/USDT:USDT`;
    }
    return symbol;
}

// ========== 技術指標 ==========
async function getEMAAndATR(symbol) {
    try {
        const tf = normalizeTimeframe(CONFIG.timeframe);
        const limit = CONFIG.emaSlow + 20;
        const ohlcv = await exchange.fetchOHLCV(symbol, tf, undefined, limit);
        if (ohlcv.length < CONFIG.emaSlow + 5) return null;

        const closes = ohlcv.map(c => c[4]);
        const highs = ohlcv.map(c => c[2]);
        const lows = ohlcv.map(c => c[3]);

        const emaFastArr = EMA.calculate({ period: CONFIG.emaFast, values: closes });
        const emaSlowArr = EMA.calculate({ period: CONFIG.emaSlow, values: closes });
        const atrArr = ATR.calculate({ period: CONFIG.atrPeriod, high: highs, low: lows, close: closes });

        return {
            emaFast: emaFastArr[emaFastArr.length - 1],
            emaFastPrev: emaFastArr[emaFastArr.length - 2],
            emaSlow: emaSlowArr[emaSlowArr.length - 1],
            emaSlowPrev: emaSlowArr[emaSlowArr.length - 2],
            atr: atrArr[atrArr.length - 1],
            currentPrice: closes[closes.length - 1],
        };
    } catch (e) {
        log(`指標計算失敗: ${e.message}`);
        return null;
    }
}

// ========== 訊號判斷 ==========
function detectSignal(indicators) {
    const { emaFast, emaFastPrev, emaSlow, emaSlowPrev } = indicators;

    // 黃金交叉：快線由下往上穿越慢線
    if (emaFastPrev <= emaSlowPrev && emaFast > emaSlow) {
        return 'golden_cross'; // 做多
    }
    // 死亡交叉：快線由上往下穿越慢線
    if (emaFastPrev >= emaSlowPrev && emaFast < emaSlow) {
        return 'death_cross'; // 做空
    }
    return null;
}

// ========== 下單 ==========
async function openPosition(symbol, side, price, atr) {
    if (CONFIG.simMode) {
        log(`[模擬] 開倉 ${side} @ ${price.toFixed(4)}`);
        return;
    }

    try {
        await exchange.setLeverage(CONFIG.leverage, symbol);

        const notional = CONFIG.investment * CONFIG.leverage;
        let amount = notional / price;
        try { amount = exchange.amountToPrecision(symbol, amount); } catch { amount = Math.floor(amount); }

        const stopLoss = side === 'long'
            ? price - atr * CONFIG.atrStopMultiplier
            : price + atr * CONFIG.atrStopMultiplier;

        const takeProfit = side === 'long'
            ? price + atr * CONFIG.atrTpMultiplier
            : price - atr * CONFIG.atrTpMultiplier;

        const order = await exchange.createOrder(symbol, 'market', side === 'long' ? 'buy' : 'sell', amount);

        botState.position = { side, entryPrice: price, amount, stopLoss, takeProfit, orderId: order.id };

        log(`✅ 開倉 ${side.toUpperCase()} @ ${price.toFixed(4)} | 停損: ${stopLoss.toFixed(4)} | 停利: ${takeProfit.toFixed(4)}`);
        notifyUser(`✅ 開倉 ${side === 'long' ? '做多 📈' : '做空 📉'} ${symbol}\n價格: ${price.toFixed(4)}\n停損: ${stopLoss.toFixed(4)}\n停利: ${takeProfit.toFixed(4)}`);
    } catch (e) {
        log(`❌ 開倉失敗: ${e.message}`);
    }
}

async function closePosition(symbol, reason) {
    if (!botState.position) return;
    if (CONFIG.simMode) {
        log(`[模擬] 平倉，原因: ${reason}`);
        botState.position = null;
        return;
    }

    try {
        const { side, amount } = botState.position;
        const closeSide = side === 'long' ? 'sell' : 'buy';
        await exchange.createOrder(symbol, 'market', closeSide, amount, undefined, { reduceOnly: true });

        log(`✅ 平倉完成，原因: ${reason}`);
        notifyUser(`🔄 平倉 ${symbol}\n原因: ${reason}`);
        botState.position = null;
        botState.tradeCount++;
    } catch (e) {
        log(`❌ 平倉失敗: ${e.message}`);
    }
}

// ========== 風控 ==========
async function getCurrentEquity() {
    try {
        const balance = await exchange.fetchBalance();
        return parseFloat(balance.total?.USDT || balance.USDT?.total || 0);
    } catch (e) {
        return null;
    }
}

async function checkStopLoss() {
    if (!CONFIG.stopLossEnabled || CONFIG.simMode) return false;

    const equity = await getCurrentEquity();
    if (equity === null) return false;

    const today = new Date().toISOString().slice(0, 10);
    if (botState.dailyLossDate !== today) {
        botState.dailyLoss = 0;
        botState.dailyLossDate = today;
        log(`📅 新的一天，每日虧損重置`);
    }
    if (equity > botState.peakEquity) botState.peakEquity = equity;

    const currentLoss = botState.entryEquity - equity;
    const drawdown = botState.peakEquity - equity;

    if (currentLoss >= CONFIG.investment * CONFIG.stopLossPercent) {
        log(`🛑 [停損] 虧損 ${currentLoss.toFixed(2)}U，停止交易`);
        notifyUser(`🛑 停損觸發！虧損 ${currentLoss.toFixed(2)}U`);
        return true;
    }
    botState.dailyLoss = Math.max(botState.dailyLoss, currentLoss);
    if (botState.dailyLoss >= CONFIG.investment * CONFIG.dailyLossLimit) {
        log(`🛑 [每日停損] 今日虧損 ${botState.dailyLoss.toFixed(2)}U，暫停到明天`);
        notifyUser(`🛑 每日停損觸發！今日虧損 ${botState.dailyLoss.toFixed(2)}U`);
        return true;
    }
    if (drawdown >= CONFIG.investment * CONFIG.maxDrawdownPercent) {
        log(`🛑 [回撤停損] 回撤 ${drawdown.toFixed(2)}U，停止交易`);
        notifyUser(`🛑 回撤停損觸發！回撤 ${drawdown.toFixed(2)}U`);
        return true;
    }

    log(`✅ 風控正常 | 權益: ${equity.toFixed(2)}U | 虧損: ${currentLoss.toFixed(2)}U`);
    return false;
}

// ========== 每日報表 ==========
async function sendDailyReport() {
    const today = new Date().toISOString().slice(0, 10);
    if (botState.lastReportDate === today) return;

    const equity = await getCurrentEquity();
    const pnl = equity !== null ? (equity - botState.entryEquity).toFixed(2) : '無法取得';
    const pnlPct = equity !== null ? (((equity - botState.entryEquity) / botState.entryEquity) * 100).toFixed(2) : '-';

    const report = [
        `📊 趨勢機器人每日報表 ${today}`,
        `━━━━━━━━━━━━━━━━`,
        `交易幣種: ${botState.symbol || '未選幣'}`,
        `帳戶權益: ${equity !== null ? equity.toFixed(2) + ' USDT' : '無法取得'}`,
        `當日盈虧: ${pnl} USDT (${pnlPct}%)`,
        `今日成交: ${botState.tradeCount} 次`,
        `目前倉位: ${botState.position ? `${botState.position.side.toUpperCase()} @ ${botState.position.entryPrice.toFixed(4)}` : '無'}`,
    ].join('\n');

    log(`\n${report}`);
    notifyUser(report);
    botState.tradeCount = 0;
    botState.lastReportDate = today;
}

function scheduleDailyReport() {
    const now = new Date();
    const next8am = new Date();
    next8am.setHours(8, 0, 0, 0);
    if (now >= next8am) next8am.setDate(next8am.getDate() + 1);
    const msUntil = next8am - now;
    log(`📅 每日報表將於 ${next8am.toLocaleString()} 發送`);
    setTimeout(async () => {
        await sendDailyReport();
        setInterval(sendDailyReport, 24 * 60 * 60 * 1000);
    }, msUntil);
}

// ========== 主迴圈 ==========
async function monitorTrend() {
    log('🚀 趨勢追蹤機器人啟動...');
    logExchangeInfo();
    scheduleDailyReport();

    while (true) {
        try {
            // 0. 風控檢查
            const shouldStop = await checkStopLoss();
            if (shouldStop) {
                if (botState.position) await closePosition(botState.symbol, '風控停損');
                log('🛑 風控觸發，機器人停止。請檢查帳戶後手動重啟。');
                process.exit(1);
            }

            // 1. 選幣
            const symbol = await selectSymbol();
            if (!symbol) {
                await new Promise(r => setTimeout(r, CONFIG.checkInterval));
                continue;
            }
            if (botState.symbol !== symbol) {
                log(`📥 切換交易對: ${symbol}`);
                if (botState.position) await closePosition(botState.symbol, `切換幣種至 ${symbol}`);
                botState.symbol = symbol;
            }

            // 2. 取得指標
            const indicators = await getEMAAndATR(symbol);
            if (!indicators) {
                await new Promise(r => setTimeout(r, CONFIG.checkInterval));
                continue;
            }

            const { emaFast, emaSlow, atr, currentPrice } = indicators;
            log(`📊 ${symbol} | 價格: ${currentPrice.toFixed(4)} | EMA${CONFIG.emaFast}: ${emaFast.toFixed(4)} | EMA${CONFIG.emaSlow}: ${emaSlow.toFixed(4)} | ATR: ${atr.toFixed(4)}`);

            // 3. 檢查現有倉位的停損/停利
            if (botState.position) {
                const { side, stopLoss, takeProfit } = botState.position;
                if (side === 'long') {
                    if (currentPrice <= stopLoss) {
                        await closePosition(symbol, `觸及停損 ${stopLoss.toFixed(4)}`);
                    } else if (currentPrice >= takeProfit) {
                        await closePosition(symbol, `觸及停利 ${takeProfit.toFixed(4)}`);
                    }
                } else {
                    if (currentPrice >= stopLoss) {
                        await closePosition(symbol, `觸及停損 ${stopLoss.toFixed(4)}`);
                    } else if (currentPrice <= takeProfit) {
                        await closePosition(symbol, `觸及停利 ${takeProfit.toFixed(4)}`);
                    }
                }
            }

            // 4. 偵測訊號
            const signal = detectSignal(indicators);
            if (signal && signal !== botState.lastSignal) {
                botState.lastSignal = signal;

                if (signal === 'golden_cross') {
                    log(`🟢 黃金交叉！準備做多...`);
                    if (botState.position?.side === 'short') await closePosition(symbol, '反向訊號');
                    if (!botState.position) await openPosition(symbol, 'long', currentPrice, atr);
                } else if (signal === 'death_cross') {
                    log(`🔴 死亡交叉！準備做空...`);
                    if (botState.position?.side === 'long') await closePosition(symbol, '反向訊號');
                    if (!botState.position) await openPosition(symbol, 'short', currentPrice, atr);
                }
            }

        } catch (e) {
            log(`監控錯誤: ${e.message}`);
        }

        await new Promise(r => setTimeout(r, CONFIG.checkInterval));
    }
}

monitorTrend();
