/**
 * trend_bot_multi.js - 趨勢追蹤策略機器人 v2（改良版）
 *
 * 策略邏輯（改良版，與回測一致）：
 * - EMA20 黃金交叉 EMA50 → 做多（只做多）
 * - RSI 過濾：RSI > 65 時不進場（避免追高）
 * - 量能確認：成交量需 > 20期均量 × 1.2（過濾假突破）
 * - 移動停損：獲利達 1x ATR 後啟動，距離 1.5x ATR
 * - 死叉出場：EMA 死叉時平倉
 * - 風控三道防線（同 grid bot）
 *
 * 初始配置（288U 資金）：
 * - 每幣投入 48U，2x 槓桿
 * - 建議幣種：STORJ、FHE、LTC（低回撤）
 */

import ccxt from 'ccxt';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { EMA, ATR, RSI } from 'technicalindicators';
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
    // 交易設定（依你的資金：288U 分 3 幣，每幣 48U）
    investment: parseFloat(process.env.TREND_INVESTMENT) || 48,
    leverage: 2,
    checkInterval: 60000 * 5,  // 每 5 分鐘檢查

    // EMA 設定
    emaFast: 20,
    emaSlow: 50,
    timeframe: '4h',

    // ATR 停損設定
    atrPeriod: 14,
    atrStopMultiplier: 2.0,        // 初始停損 = 進場價 - 2x ATR
    atrTrailActivate: 1.0,         // 獲利達 1x ATR 後啟動移動停損
    atrTrailDistance: 1.5,         // 移動停損距離 = 1.5x ATR

    // RSI 過濾
    rsiPeriod: 14,
    rsiMaxBuy: 65,                 // RSI > 65 不進場（超買）

    // 量能確認
    volumeMaPeriod: 20,
    volumeMinRatio: 1.2,           // 成交量需 > 均量 × 1.2

    // 只做多
    longOnly: true,

    // 風控
    stopLossEnabled: true,
    stopLossPercent: 0.15,         // 單次虧損 15% 停止
    dailyLossLimit: 0.20,          // 每日虧損 20% 暫停
    maxDrawdownPercent: 0.30,      // 最大回撤 30% 停止

    simMode: process.env.TREND_SIM_MODE === 'true' || false,

    // 自動輪動（若 TREND_SYMBOL 未設定才啟用）
    enableRotation: !process.env.TREND_SYMBOL,
    rotationInterval: 60000 * 60 * 4,          // 每 4 小時評估一次
    rotationCooldown: 60000 * 60 * 2,          // 輪動後 2 小時內不再輪動
    rotationImprovementThreshold: 1.3,         // 分數需高 30% 以上才切換
    rotationOnlyWhenNoPosition: false,         // true = 只在空倉時才輪動
};

// backtest.db 讀取（用於自動輪動評分）
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

// NanoClaw IPC 通知
const NANOCLAW_IPC_DIR = process.env.NANOCLAW_IPC_DIR || '/home/mky/nanoclaw/data/ipc/main/messages';
const NANOCLAW_CHAT_JID = process.env.NANOCLAW_CHAT_JID || '886915721620@s.whatsapp.net';

// ========== 狀態 ==========
let botState = {
    symbol: null,
    position: null,     // { side, entryPrice, amount, stopLoss, trailActivated, trailStop }
    lastSignal: null,
    peakEquity: CONFIG.investment,
    dailyLoss: 0,
    dailyLossDate: '',
    entryEquity: CONFIG.investment,
    tradeCount: 0,
    lastReportDate: '',
    lastRotationCheck: 0,
    lastRotationTime: 0,
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

// ========== 選幣（從環境變數或 market_data.json + 回測評分） ==========

// 計算幣種綜合分數（波動性 50% + 回測報酬 30% + 低回撤 20%）
function calcCombinedScore(item) {
    const vol = typeof item.volatilityScore === 'number' ? item.volatilityScore : 0;
    let symbol = item.symbol;
    if (!symbol.includes('/') && symbol.endsWith('USDT')) {
        symbol = `${symbol.replace('USDT', '')}/USDT:USDT`;
    }
    const bt = getBacktestScore(symbol);
    if (bt && bt.pnl > 0) {
        const btScore = (bt.pnl / 100) * 0.3 - (bt.drawdown / 100) * 0.2;
        return { symbol, score: vol * 0.5 + btScore, bt };
    }
    return { symbol, score: vol, bt: null };
}

async function selectSymbol() {
    // 優先使用環境變數指定的幣種
    if (process.env.TREND_SYMBOL) {
        return normalizeSymbol(process.env.TREND_SYMBOL);
    }

    const data = await readMarketData();
    if (!data || data.length === 0) {
        log('⚠️ market_data.json 無資料，等待市場掃描...');
        return null;
    }

    // 計算所有幣種分數並排序
    const scored = data.map(item => calcCombinedScore(item));
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (best.bt) {
        log(`🏆 最佳幣種: ${best.symbol} | 分數: ${(best.score * 100).toFixed(2)} | 回測: +${best.bt.pnl.toFixed(1)}% | 回撤: ${best.bt.drawdown.toFixed(1)}%`);
    } else {
        log(`🏆 最佳幣種: ${best.symbol} | 波動分數: ${(best.score * 100).toFixed(2)} (無回測資料)`);
    }

    return best.symbol;
}

// 自動輪動評估（每 4 小時）
async function checkRotation() {
    if (!CONFIG.enableRotation) return;
    if (Date.now() - botState.lastRotationCheck < CONFIG.rotationInterval) return;
    botState.lastRotationCheck = Date.now();

    // 輪動冷卻中
    if (botState.lastRotationTime > 0 && Date.now() - botState.lastRotationTime < CONFIG.rotationCooldown) {
        const remain = Math.ceil((CONFIG.rotationCooldown - (Date.now() - botState.lastRotationTime)) / 60000);
        log(`⏸️ 輪動冷卻中，還需 ${remain} 分鐘`);
        return;
    }

    // 若設定為只在空倉時輪動
    if (CONFIG.rotationOnlyWhenNoPosition && botState.position) {
        log(`⏸️ 持倉中，等待平倉後再評估輪動`);
        return;
    }

    log(`🔄 執行自動輪動評估...`);
    const data = await readMarketData();
    if (!data || data.length === 0) return;

    const scored = data.map(item => calcCombinedScore(item));
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];

    if (!botState.symbol || best.symbol === botState.symbol) {
        log(`✅ 目前幣種 ${botState.symbol} 已是最佳，無需輪動`);
        return;
    }

    // 計算目前幣種分數
    const currentData = data.find(item => {
        let sym = item.symbol;
        if (!sym.includes('/') && sym.endsWith('USDT')) sym = `${sym.replace('USDT', '')}/USDT:USDT`;
        return sym === botState.symbol;
    });
    const currentScore = currentData ? calcCombinedScore(currentData).score : 0;
    const improvementRatio = currentScore > 0 ? best.score / currentScore : Infinity;

    log(`📊 目前: ${botState.symbol} (${(currentScore * 100).toFixed(2)}) | 候選: ${best.symbol} (${(best.score * 100).toFixed(2)}) | 改善: ${improvementRatio.toFixed(2)}x`);

    if (improvementRatio >= CONFIG.rotationImprovementThreshold) {
        log(`✅ 分數改善 ${((improvementRatio - 1) * 100).toFixed(0)}%，觸發輪動！`);
        notifyUser(`🔄 趨勢機器人輪動！\n${botState.symbol} → ${best.symbol}\n改善: ${((improvementRatio - 1) * 100).toFixed(0)}%`);

        // 平掉目前倉位
        if (botState.position) {
            await closePosition(botState.symbol, `輪動至 ${best.symbol}`);
        }

        botState.symbol = best.symbol;
        botState.lastSignal = null;  // 重置訊號，等待新幣種黃金交叉
        botState.lastRotationTime = Date.now();
        log(`✅ 輪動完成，現在監控: ${best.symbol}`);
    } else {
        log(`⏸️ 改善幅度不足 (需 ${CONFIG.rotationImprovementThreshold}x)，保持 ${botState.symbol}`);
    }
}

// ========== 技術指標（含 RSI + 量能） ==========
async function getIndicators(symbol) {
    try {
        const tf = normalizeTimeframe(CONFIG.timeframe);
        const limit = CONFIG.emaSlow + CONFIG.volumeMaPeriod + 10;
        const ohlcv = await exchange.fetchOHLCV(symbol, tf, undefined, limit);
        if (ohlcv.length < CONFIG.emaSlow + 5) return null;

        const closes  = ohlcv.map(c => c[4]);
        const highs   = ohlcv.map(c => c[2]);
        const lows    = ohlcv.map(c => c[3]);
        const volumes = ohlcv.map(c => c[5]);

        const emaFastArr = EMA.calculate({ period: CONFIG.emaFast, values: closes });
        const emaSlowArr = EMA.calculate({ period: CONFIG.emaSlow, values: closes });
        const atrArr     = ATR.calculate({ period: CONFIG.atrPeriod, high: highs, low: lows, close: closes });
        const rsiArr     = RSI.calculate({ period: CONFIG.rsiPeriod, values: closes });

        // 計算成交量均量（用倒數第二根已完成K線，避免最新未完成K線量能偏低）
        const completedVols = volumes.slice(0, -1); // 排除最新未完成K線
        const recentVols = completedVols.slice(-CONFIG.volumeMaPeriod);
        const volMa = recentVols.reduce((a, b) => a + b, 0) / recentVols.length;
        const currentVol = completedVols[completedVols.length - 1]; // 最近完成的K線量能

        return {
            emaFast:     emaFastArr[emaFastArr.length - 1],
            emaFastPrev: emaFastArr[emaFastArr.length - 2],
            emaSlow:     emaSlowArr[emaSlowArr.length - 1],
            emaSlowPrev: emaSlowArr[emaSlowArr.length - 2],
            atr:         atrArr[atrArr.length - 1],
            rsi:         rsiArr[rsiArr.length - 1],
            currentVol,
            volMa,
            currentPrice: closes[closes.length - 1],
        };
    } catch (e) {
        log(`指標計算失敗: ${e.message}`);
        return null;
    }
}

// ========== 下單 ==========
async function openPosition(symbol, price, atr) {
    if (CONFIG.simMode) {
        log(`[模擬] 開多倉 @ ${price.toFixed(4)}`);
        botState.position = {
            side: 'long', entryPrice: price, amount: 0,
            stopLoss: price - atr * CONFIG.atrStopMultiplier,
            trailActivated: false, trailStop: null,
        };
        return;
    }

    try {
        await exchange.setLeverage(CONFIG.leverage, symbol);

        const notional = CONFIG.investment * CONFIG.leverage;
        let amount = notional / price;
        try { amount = exchange.amountToPrecision(symbol, amount); } catch { amount = Math.floor(amount * 1000) / 1000; }

        const stopLoss = price - atr * CONFIG.atrStopMultiplier;
        const order = await exchange.createOrder(symbol, 'market', 'buy', amount);

        botState.position = {
            side: 'long', entryPrice: price, amount,
            stopLoss, trailActivated: false, trailStop: null,
            orderId: order.id,
        };

        log(`✅ 開多倉 @ ${price.toFixed(4)} | 停損: ${stopLoss.toFixed(4)} | 數量: ${amount}`);
        notifyUser(`✅ 開多倉 📈 ${symbol}\n價格: ${price.toFixed(4)}\n停損: ${stopLoss.toFixed(4)}\n投入: ${CONFIG.investment}U × ${CONFIG.leverage}x`);
    } catch (e) {
        log(`❌ 開倉失敗: ${e.message}`);
    }
}

async function closePosition(symbol, reason, closePrice) {
    if (!botState.position) return;
    if (CONFIG.simMode) {
        log(`[模擬] 平倉，原因: ${reason}`);
        botState.position = null;
        botState.tradeCount++;
        return;
    }

    try {
        const { amount } = botState.position;
        await exchange.createOrder(symbol, 'market', 'sell', amount, undefined, { reduceOnly: true });
        log(`✅ 平倉完成，原因: ${reason}${closePrice ? ` @ ${closePrice.toFixed(4)}` : ''}`);
        notifyUser(`🔄 平倉 ${symbol}\n原因: ${reason}${closePrice ? `\n價格: ${closePrice.toFixed(4)}` : ''}`);
        botState.position = null;
        botState.tradeCount++;
    } catch (e) {
        log(`❌ 平倉失敗: ${e.message}`);
    }
}

// ========== 移動停損更新 ==========
function updateTrailingStop(currentPrice, atr) {
    if (!botState.position) return;
    const { entryPrice, trailActivated } = botState.position;

    const profit = (currentPrice - entryPrice) / entryPrice * CONFIG.leverage;
    const atrActivateThreshold = CONFIG.atrTrailActivate * atr / entryPrice * CONFIG.leverage;

    // 啟動移動停損
    if (!trailActivated && profit >= atrActivateThreshold) {
        botState.position.trailActivated = true;
        botState.position.trailStop = currentPrice - atr * CONFIG.atrTrailDistance;
        log(`🔄 移動停損啟動！停損跟至: ${botState.position.trailStop.toFixed(4)}`);
    }

    // 移動停損跟進
    if (botState.position.trailActivated) {
        const newTrail = currentPrice - atr * CONFIG.atrTrailDistance;
        if (newTrail > botState.position.trailStop) {
            botState.position.trailStop = newTrail;
            log(`📈 移動停損更新: ${newTrail.toFixed(4)}`);
        }
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
        `目前倉位: ${botState.position ? `多單 @ ${botState.position.entryPrice.toFixed(4)}${botState.position.trailActivated ? ' [移動停損中]' : ''}` : '無'}`,
        `策略: EMA${CONFIG.emaFast}/${CONFIG.emaSlow} + RSI<${CONFIG.rsiMaxBuy} + 量能確認 + 移動停損`,
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
    log('🚀 趨勢追蹤機器人 v2 啟動（改良版：RSI+量能+移動停損+只做多）');
    log(`💰 投入: ${CONFIG.investment}U | 槓桿: ${CONFIG.leverage}x | RSI上限: ${CONFIG.rsiMaxBuy} | 量能需: ${CONFIG.volumeMinRatio}x`);
    if (CONFIG.simMode) log('⚠️ 模擬模式開啟，不會實際下單');
    logExchangeInfo();

    // 啟動時讀取實際帳戶餘額作為風控基準
    if (!CONFIG.simMode) {
        const initialEquity = await getCurrentEquity();
        if (initialEquity !== null) {
            botState.entryEquity = initialEquity;
            botState.peakEquity = initialEquity;
            log(`💼 帳戶起始餘額: ${initialEquity.toFixed(2)}U（風控基準）`);
        }
    }

    scheduleDailyReport();

    // 啟動時先選幣
    if (!botState.symbol) {
        const initialSymbol = await selectSymbol();
        if (initialSymbol) {
            botState.symbol = initialSymbol;
            log(`📥 啟動交易對: ${initialSymbol}`);
        }
        botState.lastRotationCheck = Date.now(); // 啟動後 4 小時再評估輪動
    }

    if (CONFIG.enableRotation) {
        log(`🔄 自動輪動已啟用（每 ${CONFIG.rotationInterval / 60000} 分鐘評估，分數改善需 ${CONFIG.rotationImprovementThreshold}x）`);
    }

    while (true) {
        try {
            // 0. 風控檢查
            const shouldStop = await checkStopLoss();
            if (shouldStop) {
                if (botState.position) await closePosition(botState.symbol, '風控停損');
                log('🛑 風控觸發，機器人停止。請檢查帳戶後手動重啟。');
                notifyUser('🛑 趨勢機器人已停止，請檢查帳戶！');
                process.exit(1);
            }

            // 1. 自動輪動評估（每 4 小時，TREND_SYMBOL 固定時跳過）
            await checkRotation();

            // 2. 選幣（首次選幣，之後由輪動控制）
            if (!botState.symbol) {
                const symbol = await selectSymbol();
                if (!symbol) {
                    await new Promise(r => setTimeout(r, CONFIG.checkInterval));
                    continue;
                }
                log(`📥 初始交易對: ${symbol}`);
                botState.symbol = symbol;
            }
            const symbol = botState.symbol;

            // 3. 取得指標
            const ind = await getIndicators(symbol);
            if (!ind) {
                await new Promise(r => setTimeout(r, CONFIG.checkInterval));
                continue;
            }

            const { emaFast, emaFastPrev, emaSlow, emaSlowPrev, atr, rsi, currentVol, volMa, currentPrice } = ind;
            const volRatio = volMa > 0 ? (currentVol / volMa).toFixed(2) : '?';

            log(`📊 ${symbol} | 價格: ${currentPrice.toFixed(4)} | EMA${CONFIG.emaFast}: ${emaFast.toFixed(4)} | EMA${CONFIG.emaSlow}: ${emaSlow.toFixed(4)} | ATR: ${atr.toFixed(4)} | RSI: ${rsi.toFixed(1)} | 量能: ${volRatio}x`);

            // 4. 持倉管理（移動停損 + 固定停損 + 死叉出場）
            if (botState.position) {
                const { stopLoss, trailActivated, trailStop } = botState.position;

                // 更新移動停損
                updateTrailingStop(currentPrice, atr);

                // 移動停損觸發
                if (trailActivated && currentPrice <= botState.position.trailStop) {
                    await closePosition(symbol, '移動停損', botState.position.trailStop);
                }
                // 固定停損
                else if (currentPrice <= stopLoss) {
                    await closePosition(symbol, `觸及停損`, stopLoss);
                }
                // 死叉出場
                else if (emaFastPrev >= emaSlowPrev && emaFast < emaSlow) {
                    await closePosition(symbol, '死叉出場', currentPrice);
                }
            }

            // 5. 進場訊號（黃金交叉 + RSI + 量能）
            const isGoldenCross = emaFastPrev <= emaSlowPrev && emaFast > emaSlow;

            if (isGoldenCross && botState.lastSignal !== 'golden_cross' && !botState.position) {
                botState.lastSignal = 'golden_cross';
                log(`🟢 黃金交叉！RSI: ${rsi.toFixed(1)} | 量能: ${volRatio}x`);

                // RSI 過濾
                if (rsi > CONFIG.rsiMaxBuy) {
                    log(`⚠️ RSI ${rsi.toFixed(1)} > ${CONFIG.rsiMaxBuy}，過濾此訊號（超買）`);
                    notifyUser(`⚠️ 黃金交叉但 RSI 過高 (${rsi.toFixed(1)})，跳過不進場`);
                }
                // 量能過濾
                else if (volMa > 0 && currentVol < volMa * CONFIG.volumeMinRatio) {
                    log(`⚠️ 量能不足 (${volRatio}x < ${CONFIG.volumeMinRatio}x)，過濾此訊號`);
                    notifyUser(`⚠️ 黃金交叉但量能不足 (${volRatio}x)，跳過不進場`);
                }
                // 進場
                else {
                    log(`✅ 條件通過！進場做多...`);
                    await openPosition(symbol, currentPrice, atr);
                }
            }

            // 死叉重置訊號狀態
            if (emaFastPrev >= emaSlowPrev && emaFast < emaSlow) {
                botState.lastSignal = 'death_cross';
            }

        } catch (e) {
            log(`監控錯誤: ${e.message}`);
        }

        await new Promise(r => setTimeout(r, CONFIG.checkInterval));
    }
}

monitorTrend();
