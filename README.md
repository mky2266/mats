# 🤖 MATS - 加密貨幣多交易所自動交易系統

**MATS** (Multi-exchange Automated Trading System)

一套完整的加密貨幣自動交易系統，支援趨勢跟隨和網格交易策略，可在 Binance、Bybit、OKX、Bitget 等主流交易所運行。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-lightgrey.svg)]()

---

## 📋 目錄

- [功能特色](#features)
- [系統架構](#architecture)
- [支援的交易所](#exchanges)
- [系統需求](#requirements)
- [Windows 安裝](#windows-install)
- [Linux 安裝](#linux-install)
- [手機安裝 (Android)](#mobile-install)
- [配置說明](#configuration)
- [啟動機器人](#start-bots)
- [使用指南](#usage-guide)
- [常見問題](#faq)
- [安全建議](#security)

---

## ✨ 功能特色
<a id="features"></a>

### 🎯 **三大核心機器人**

1. **市場掃描器** - 自動掃描高流動性幣種，每 12 小時更新
2. **趨勢交易機器人** - EMA + ADX + RSI 多指標策略，動態止損
3. **網格交易機器人** - ATR 動態網格，自動幣種輪動

### 🌐 **多交易所支援**

- ✅ 支援 Binance、Bybit、OKX、Bitget
- ✅ 一行代碼切換交易所
- ✅ 自動處理 API 差異
- ✅ 可同時運行多個交易所

---

## 🏗️ 系統架構
<a id="architecture"></a>

```
exchange_config.js (統一配置中心)
    │
    ├─→ market_scanner_multi.js  (市場掃描器)
    ├─→ bot_multi.js              (趨勢機器人)
    └─→ grid_bot_multi.js         (網格機器人)
         ↓
    market_data.json
         ↓
    calculate_profit_multi.js    (收益計算)
```

---

## 🌐 支援的交易所
<a id="exchanges"></a>

| 交易所 | 手續費 (Maker/Taker) | 特色 |
|--------|---------------------|------|
| **Binance** | 0.02% / 0.04% | 流動性最高 |
| **Bybit** | -0.025% / 0.075% | Maker 返傭 |
| **OKX** | 0.02% / 0.05% | 產品豐富 |
| **Bitget** | 0.02% / 0.06% | 跟單功能 |

---

## 💻 系統需求
<a id="requirements"></a>

### **電腦（Windows/Linux）**
- **Node.js**: 18.0.0 或更高
- **記憶體**: 最低 1GB，建議 2GB+
- **硬碟**: 500MB 可用空間
- **網路**: 穩定連線

### **手機（Android）**
- **系統**: Android 7.0+
- **記憶體**: 最低 2GB，建議 4GB+
- **儲存**: 2GB 可用空間
- **應用**: Termux（F-Droid）
- **建議**: 連接充電器

---

## 🪟 Windows 安裝
<a id="windows-install"></a>

### **步驟 1：安裝 Node.js**

1. 前往 [nodejs.org](https://nodejs.org/)
2. 下載 **LTS 版本**
3. 執行安裝（勾選所有選項）
4. 重啟電腦

**驗證：**
```cmd
node --version
npm --version
```

---

### **步驟 2：創建目錄**

```cmd
cd Desktop
mkdir crypto-bot
cd crypto-bot
```

---

### **步驟 3：放置檔案**

將所有檔案放入 `crypto-bot` 資料夾：
```
crypto-bot/
├── exchange_config.js
├── market_scanner_multi.js
├── bot_multi.js
├── grid_bot_multi.js
├── calculate_profit_multi.js
├── ecosystem.config.cjs          ← 注意是 .cjs
└── env.example.txt               ← API 範本（改名為 .txt 方便查看）
```

**重要：** 配置檔名稱是 `ecosystem.config.cjs`（副檔名 `.cjs`），不是 `.js`

---

### **步驟 4：安裝套件**

```cmd
npm init -y
npm install ccxt dotenv technicalindicators
```

**加速安裝（可選）：**
```cmd
npm config set registry https://registry.npmmirror.com
npm install ccxt dotenv technicalindicators
```

---

### **步驟 5：安裝 PM2**

```cmd
npm install -g pm2
```

**如遇權限問題：**
- 右鍵「命令提示字元」→ 以系統管理員身分執行

---

### **步驟 6：配置 API**

```cmd
# 複製範本（改名為 .env）
copy env.example.txt .env

# 編輯 .env
notepad .env
```

填入 API 金鑰：
```env
BINANCE_API_KEY=你的金鑰
BINANCE_SECRET=你的密鑰
```

---

### **步驟 7：選擇交易所**

```cmd
notepad exchange_config.js
```

修改第 5 行：
```javascript
export const EXCHANGE_NAME = 'binance';
```

---

### **步驟 8：創建日誌目錄**

```cmd
mkdir logs
```

---

### **步驟 9：啟動**

```cmd
pm2 start ecosystem.config.cjs
pm2 status
pm2 logs
```

---

### **步驟 10：開機自動啟動（可選）**

```cmd
npm install -g pm2-windows-startup
pm2-startup install
pm2 save
```

---

## 🐧 Linux 安裝
<a id="linux-install"></a>

### **步驟 1：安裝 Node.js**

**Ubuntu/Debian:**
```bash
sudo apt update
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

**CentOS/RHEL:**
```bash
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs
```

**使用 NVM（推薦）:**
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
```

**驗證：**
```bash
node --version
npm --version
```

---

### **步驟 2：創建目錄**

```bash
mkdir -p ~/crypto-bot
cd ~/crypto-bot
```

---

### **步驟 3：上傳檔案**

**方法 A：使用 SCP**
```bash
scp *.js user@server:~/crypto-bot/
```

**方法 B：手動創建**
```bash
nano exchange_config.js
# 貼上內容，Ctrl+O 儲存，Ctrl+X 退出
```

---

### **步驟 4：安裝套件**

```bash
npm init -y
npm install ccxt dotenv technicalindicators
```

---

### **步驟 5：安裝 PM2**

```bash
sudo npm install -g pm2
pm2 --version
```

---

### **步驟 6：配置 API**

```bash
# 複製範本（改名為 .env）
cp env.example.txt .env

# 編輯 .env
nano .env
```

填入 API 金鑰，按 `Ctrl+O` 儲存，`Ctrl+X` 退出

---

### **步驟 7：選擇交易所**

```bash
nano exchange_config.js
```

修改第 5 行

---

### **步驟 8：設置權限**

```bash
mkdir -p logs
chmod +x *.js
chmod 600 .env
```

---

### **步驟 9：啟動**

```bash
pm2 start ecosystem.config.cjs
pm2 status
pm2 logs
```

---

### **步驟 10：開機自動啟動**

```bash
pm2 startup
# 執行輸出的指令（需要 sudo）
pm2 save
```

---

## 📱 手機安裝 (Android)
<a id="mobile-install"></a>

### **前置準備**

1. **下載 Termux**
   - Google Play: [Termux](https://play.google.com/store/apps/details?id=com.termux)
   - F-Droid（推薦）: [F-Droid Termux](https://f-droid.org/packages/com.termux/)
   
2. **為什麼推薦 F-Droid 版本？**
   - Google Play 版本可能不是最新
   - F-Droid 版本更新更及時

---

### **步驟 1：更新 Termux 套件**

開啟 Termux，執行：

```bash
# 更新套件列表
pkg update

# 升級所有套件（會詢問是否繼續，輸入 y）
pkg upgrade
```

**提示：** 如果提示 "Do you want to continue? [Y/n]"，輸入 `y` 並按 Enter

---

### **步驟 2：安裝必要套件**

```bash
# 安裝 Node.js 和 Git
pkg install nodejs git

# 驗證安裝
node --version
npm --version
```

**應該顯示：**
```
v20.x.x
10.x.x
```

---

### **步驟 3：允許訪問儲存空間（可選）**

如果需要從手機下載檔案：

```bash
termux-setup-storage
```

**會彈出權限請求，點選「允許」**

---

### **步驟 4：創建專案目錄**

```bash
# 創建目錄
mkdir -p ~/Crypto_Bot_Multi
cd ~/Crypto_Bot_Multi
```

---

### **步驟 5：上傳檔案到手機**

#### **方法 A：使用電腦傳輸**

1. **手機連接電腦（USB）**
2. **將所有 .js 檔案複製到：**
   ```
   內部儲存空間/Download/
   ```
3. **在 Termux 中複製檔案：**
   ```bash
   cp ~/storage/downloads/*.js ~/Crypto_Bot_Multi/
   cp ~/storage/downloads/env.example.txt ~/Crypto_Bot_Multi/
   ```

#### **方法 B：使用 Termux FTP**

```bash
# 安裝 FTP 伺服器
pkg install openssh

# 啟動 SSH 服務
sshd

# 查看用戶名和 IP
whoami
ifconfig
```

**從電腦使用 SFTP 上傳檔案**

#### **方法 C：直接下載（如果有 GitHub/URL）**

```bash
# 使用 wget 或 curl 下載
wget https://your-url/exchange_config.js
# 或
curl -O https://your-url/exchange_config.js
```

#### **方法 D：手動創建（逐個檔案）**

```bash
# 使用 nano 編輯器創建檔案
nano exchange_config.js

# 貼上內容
# 按 Ctrl + O 儲存
# 按 Ctrl + X 退出
```

---

### **步驟 6：初始化專案**

```bash
# 確認在正確目錄
pwd
# 應該顯示：/data/data/com.termux/files/home/Crypto_Bot_Multi

# 列出檔案
ls -la

# 創建 package.json
cat > package.json << 'EOF'
{
  "name": "crypto-bot-multi",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "ccxt": "^4.2.25",
    "dotenv": "^16.4.1",
    "technicalindicators": "^3.1.0"
  }
}
EOF
```

---

### **步驟 7：安裝依賴套件**

```bash
# 使用淘寶鏡像加速
npm config set registry https://registry.npmmirror.com

# 安裝依賴
npm install

# 驗證安裝
ls node_modules/ | grep -E "ccxt|dotenv|technical"
```

**應該看到：**
```
ccxt
dotenv
technicalindicators
```

---

### **步驟 8：安裝 PM2**

```bash
npm install -g pm2

# 驗證
pm2 --version
```

---

### **步驟 9：配置 API 金鑰**

```bash
# 複製範本（改名為 .env）
cp env.example.txt .env

# 編輯 .env
nano .env
```

**填入您的 API 金鑰：**
```env
BINANCE_API_KEY=你的金鑰
BINANCE_SECRET=你的密鑰
```

**儲存並退出：**
- 按 `Ctrl + O`（儲存）
- 按 `Enter`（確認）
- 按 `Ctrl + X`（退出）

---

### **步驟 10：選擇交易所**

```bash
nano exchange_config.js
```

**修改第 5 行：**
```javascript
export const EXCHANGE_NAME = 'binance';
```

---

### **步驟 11：創建日誌目錄**

```bash
mkdir -p logs
```

---

### **步驟 12：啟動機器人**

```bash
# 方法 1：使用配置檔（推薦）
pm2 start ecosystem.config.cjs

# 方法 2：單獨啟動
pm2 start market_scanner_multi.js --name "market-scanner"
pm2 start bot_multi.js --name "trend-bot"
pm2 start grid_bot_multi.js --name "grid-bot"

# 查看狀態
pm2 status

# 查看日誌
pm2 logs
```

---

### **步驟 13：保持 Termux 背景運行**

#### **方法 A：使用 Wake Lock（推薦）**

1. **安裝 Termux:Boot**（從 F-Droid）
2. **在 Termux 中執行：**
   ```bash
   # 防止 Termux 被殺掉
   termux-wake-lock
   ```

#### **方法 B：使用通知鎖定**

在 Termux 設定中：
- Settings → Termux → 電池最佳化 → 不要最佳化

#### **方法 C：開機自動啟動**

```bash
# 創建啟動腳本
mkdir -p ~/.termux/boot
nano ~/.termux/boot/start-bots.sh
```

**內容：**
```bash
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock
cd ~/Crypto_Bot_Multi
pm2 resurrect
```

**設置權限：**
```bash
chmod +x ~/.termux/boot/start-bots.sh
```

---

### **📱 手機特別注意事項**

#### **1. 電池管理**

**防止被系統殺掉：**
```bash
# 執行 wake lock
termux-wake-lock

# 檢查是否生效
pm2 status
```

**手機設定：**
- 關閉「電池最佳化」
- 允許 Termux 背景運行
- 加入「不清理」白名單

---

#### **2. 網路連線**

**確保穩定連線：**
- 使用 WiFi（推薦）
- 避免頻繁切換網路
- 確保信號穩定

**測試連線：**
```bash
ping -c 5 api.binance.com
```

---

#### **3. 儲存空間**

**檢查可用空間：**
```bash
df -h
```

**至少需要：** 500MB 可用空間

---

#### **4. 效能優化**

**降低記憶體使用：**
```bash
# 只啟動必要的機器人
pm2 start market_scanner_multi.js --name "scanner"

# 限制記憶體
pm2 start bot_multi.js --name "trend-bot" --max-memory-restart 200M
```

---

### **🔧 手機常用指令**

#### **查看機器人狀態**
```bash
pm2 status
pm2 monit
```

#### **查看日誌**
```bash
pm2 logs --lines 20
```

#### **重啟機器人**
```bash
pm2 restart all
```

#### **停止機器人**
```bash
pm2 stop all
```

#### **儲存配置（重啟後恢復）**
```bash
pm2 save
```

#### **手機鎖屏後恢復**
```bash
# 如果 PM2 進程被殺
pm2 resurrect
```

---

### **📊 手機運行效能參考**

| 機器人 | 記憶體使用 | CPU 使用 |
|--------|-----------|---------|
| market-scanner | ~50MB | ~1% |
| trend-bot | ~80MB | ~2% |
| grid-bot | ~90MB | ~2% |
| **總計** | **~220MB** | **~5%** |

**建議手機配置：**
- RAM: 4GB 以上
- 儲存: 2GB 以上可用空間
- 電池: 連接充電器長期運行

---

### **⚠️ 手機特別提醒**

1. **不建議長期使用手機運行**
   - 手機可能過熱
   - 電池損耗
   - 系統可能殺掉背景進程

2. **推薦用途**
   - 測試和學習
   - 臨時運行
   - 監控和管理

3. **生產環境建議**
   - 使用 VPS 或雲端伺服器
   - 使用電腦（Windows/Linux）

---

### **🆘 手機常見問題**

#### **Q: Termux 被系統殺掉？**

**A:** 
```bash
# 1. 執行 wake lock
termux-wake-lock

# 2. 在系統設定中：
# - 關閉電池最佳化
# - 加入白名單
# - 允許自動啟動
```

---

#### **Q: 手機太熱？**

**A:** 
```bash
# 只運行必要的機器人
pm2 stop grid-bot
pm2 stop trend-bot

# 或降低檢查頻率（修改 CONFIG）
```

---

#### **Q: npm install 失敗？**

**A:** 
```bash
# 清除快取
npm cache clean --force

# 使用淘寶鏡像
npm config set registry https://registry.npmmirror.com

# 重新安裝
rm -rf node_modules
npm install
```

---

#### **Q: 如何遠程監控？**

**A:** 
```bash
# 方法 1：使用 SSH
pkg install openssh
sshd
# 從電腦 SSH 連入手機

# 方法 2：使用 Web UI
pm2 install pm2-web
# 瀏覽器訪問 http://手機IP:9000
```

---

### **3. 投資成本配置**

#### **網格機器人（grid_bot_multi.js）**

```javascript
const CONFIG = {
    symbol: 'DUSK/USDT:USDT',  // 交易對
    investment: 180,            // ← 網格總投入（USDT）
    gridCount: 10,              // 網格數量
    leverage: 1,                // 槓桿倍數（建議 1-2）
};
```

**修改方式：**
```bash
nano grid_bot_multi.js
# 找到第 25 行，修改 investment
```

---

#### **趨勢機器人（bot_multi.js）**

```javascript
const CONFIG = {
    maxPositions: 2,           // ← 最多同時持倉數量
    investmentPerTrade: 15,    // ← 每筆交易投入（USDT）
    leverage: 1,               // 槓桿倍數（建議 1-2）
};
```

**總投入計算：**
```
總投入 = maxPositions × investmentPerTrade × leverage
       = 2 × 15 × 1 = 30 USDT
```

**修改方式：**
```bash
nano bot_multi.js
# 找到第 24-26 行，修改 maxPositions 和 investmentPerTrade
```

---

#### **資金分配建議**

| 總資金 | 網格投入 | 趨勢單筆 | 趨勢倉位 | 總使用 | 預留 |
|--------|---------|---------|---------|--------|------|
| 100 | 60 | 10 | 2 | 80 | 20 |
| 200 | 120 | 20 | 2 | 160 | 40 |
| 300 | 180 | 30 | 2 | 240 | 60 |
| 500 | 300 | 50 | 2 | 400 | 100 |

**分配原則：**
- ✅ 預留 20% 資金作為緩衝
- ✅ 網格：60-70% 資金（穩定收益）
- ✅ 趨勢：30-40% 資金（博取大行情）
- ✅ 槓桿建議 1 倍（新手必須）

---

### **4. 收益計算器配置（calculate_profit_multi.js）**

**這是最重要的配置！必須填寫正確的投入金額。**

```javascript
const CONFIG = {
    initialInvestment: 200,    // ← 您第一次轉入交易所的金額
    
    additionalDeposits: [      // ← 後續追加的資金（如有）
        // { date: '2026-02-18', amount: 100 },
        // { date: '2026-02-25', amount: 50 },
    ],
};
```

#### **配置範例**

**範例 1：一次投入**
```javascript
// 情況：一次轉入 200 USDT
const CONFIG = {
    initialInvestment: 200,
    additionalDeposits: [],
};
```

**範例 2：分批投入**
```javascript
// 情況：初始 180，後來追加 100
const CONFIG = {
    initialInvestment: 180,
    additionalDeposits: [
        { date: '2026-02-18', amount: 100 },
    ],
};

// 總投入 = 180 + 100 = 280 USDT
```

**範例 3：多次追加**
```javascript
// 情況：初始 150，分兩次追加
const CONFIG = {
    initialInvestment: 150,
    additionalDeposits: [
        { date: '2026-02-18', amount: 50 },
        { date: '2026-02-25', amount: 100 },
    ],
};

// 總投入 = 150 + 50 + 100 = 300 USDT
```

#### **⚠️ 常見錯誤**

❌ **錯誤 1：把機器人投入當成總投入**
```javascript
// 錯誤！這是網格機器人的投入，不是總投入
initialInvestment: 150,  
```

✅ **正確：填入實際轉入交易所的總金額**
```javascript
// 正確！這是您實際轉入的金額
initialInvestment: 200,
```

---

❌ **錯誤 2：忘記記錄追加資金**
```
實際情況：初始 150，追加 100（忘記記錄）
當前資產：260 USDT

錯誤計算：
總投入 = 150（少算了 100）
收益 = 260 - 150 = 110（虛增）
收益率 = 73%（錯誤！）

正確計算：
總投入 = 150 + 100 = 250
收益 = 260 - 250 = 10
收益率 = 4%
```

#### **如何確認設定正確？**

**方法 1：查看交易所充值記錄**
1. 登入交易所
2. 資產 → 充值記錄
3. 加總所有 USDT 充值

**方法 2：執行收益計算器**
```bash
node calculate_profit_multi.js

# 檢查輸出
💵 總體收益:
初始投入: 200.00 USDT          ← 應該是您實際投入
當前總資產: 215.50 USDT
總收益: +15.50 USDT
收益率: +7.75%
```

如果剛開始（沒賺沒虧）：
```
當前總資產 ≈ 總投入
```

#### **修改方式**
```bash
nano calculate_profit_multi.js
# 找到第 44-48 行，修改 initialInvestment 和 additionalDeposits
```

---

## ⚙️ 配置說明
<a id="configuration"></a>

### **1. env.example.txt（API 金鑰範本）**

**這個檔案包含所有支援交易所的 API 變數名稱，需要複製並改名為 `.env` 後填入您的金鑰。**

```bash
# Windows
copy env.example.txt .env

# Linux / 手機
cp env.example.txt .env
```

**完整範本內容：**
```env
# ========== Binance（幣安）==========
# 取得方式：https://www.binance.com/zh-TW/my/settings/api-management
BINANCE_API_KEY=your_binance_api_key_here
BINANCE_SECRET=your_binance_secret_here

# ========== Bybit ==========
# 取得方式：https://www.bybit.com/app/user/api-management
BYBIT_API_KEY=your_bybit_api_key_here
BYBIT_SECRET=your_bybit_secret_here

# ========== OKX（歐易）==========
# 取得方式：https://www.okx.com/account/my-api
# 注意：需要額外的 Passphrase
OKX_API_KEY=your_okx_api_key_here
OKX_SECRET=your_okx_secret_here
OKX_PASSWORD=your_okx_passphrase_here

# ========== Bitget ==========
# 取得方式：https://www.bitget.com/zh-TW/account/newapi
# 注意：需要額外的 Passphrase
BITGET_API_KEY=your_bitget_api_key_here
BITGET_SECRET=your_bitget_secret_here
BITGET_PASSWORD=your_bitget_passphrase_here
```

**填入範例：**
```env
# 範例：只使用 Binance
BINANCE_API_KEY=vF8sK3mP9wQ2xR7yT4nU6hJ8kL5pN3mQ
BINANCE_SECRET=aB3cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV

# 其他交易所不使用，可以留空
BYBIT_API_KEY=
BYBIT_SECRET=

# 或直接刪除不用的行
```

**重要提醒：**
- ✅ 只需填入您使用的交易所
- ✅ OKX/Bitget 的 PASSWORD 是創建 API 時設定的 Passphrase（不是登入密碼）
- ✅ API 權限只開啟「讀取」+「交易」
- ❌ 絕不開啟「提現」權限
- ✅ 建議設置 IP 白名單

---

### **2. exchange_config.js**

```javascript
export const EXCHANGE_NAME = 'binance';  // binance, bybit, okx, bitget
```

---

### **3. 投資成本配置**

#### **網格機器人投資配置**

編輯 `grid_bot_multi.js`：

```bash
nano grid_bot_multi.js
```

找到第 23-28 行：

```javascript
const CONFIG = {
    symbol: 'DUSK/USDT:USDT',    // 交易對
    investment: 180,              // ← 總投入金額（USDT）
    gridCount: 10,                // 網格數量
    leverage: 1,                  // 槓桿倍數（建議 1-2）
    checkInterval: 30000,         // 檢查間隔（毫秒）
};
```

**配置說明：**
- `investment`: 網格機器人使用的總資金
- `gridCount`: 將資金分成多少格
- `leverage`: 槓桿倍數（1 = 不使用槓桿）

**修改範例：**
```javascript
investment: 100,   // 改成您想投入的金額
gridCount: 10,     // 10 格網格
leverage: 1,       // 1 倍槓桿（安全）
```

---

#### **趨勢機器人投資配置**

編輯 `bot_multi.js`：

```bash
nano bot_multi.js
```

找到第 24-27 行：

```javascript
const CONFIG = {
    maxPositions: 2,           // ← 最多同時持有幾個倉位
    investmentPerTrade: 15,    // ← 每筆交易投入金額（USDT）
    leverage: 1,               // 槓桿倍數（建議 1-2）
    checkInterval: 60000 * 60 * 4,  // 檢查間隔（4 小時）
};
```

**總使用資金計算：**
```
總使用 = maxPositions × investmentPerTrade × leverage
       = 2 × 15 × 1
       = 30 USDT（最大使用資金）
```

**修改範例：**
```javascript
maxPositions: 2,         // 最多同時 2 個倉位
investmentPerTrade: 20,  // 每筆投入 20 USDT
leverage: 1,             // 1 倍槓桿
// 總使用：2 × 20 × 1 = 40 USDT
```

---

#### **資金分配建議**

根據總資金規劃投資配置：

**總資金 100 USDT（保守型）**
```javascript
// 網格機器人
investment: 60,          // 60% 給網格

// 趨勢機器人
maxPositions: 2,
investmentPerTrade: 10,  // 20% 給趨勢（2×10）

// 總使用：80 USDT
// 預留：20 USDT（緩衝）
```

**總資金 300 USDT（均衡型）**
```javascript
// 網格機器人
investment: 180,         // 60% 給網格

// 趨勢機器人
maxPositions: 2,
investmentPerTrade: 30,  // 20% 給趨勢（2×30）

// 總使用：240 USDT
// 預留：60 USDT（緩衝）
```

**總資金 500 USDT（激進型）**
```javascript
// 網格機器人
investment: 300,         // 60% 給網格

// 趨勢機器人
maxPositions: 3,
investmentPerTrade: 40,  // 24% 給趨勢（3×40）

// 總使用：420 USDT
// 預留：80 USDT（緩衝）
```

**配置原則：**
- ✅ 總投入不超過帳戶資金的 80%
- ✅ 預留 20% 作為緩衝資金
- ✅ 網格投入通常 > 趨勢投入（更穩定）
- ✅ 新手建議槓桿設為 1 倍
- ✅ 單筆投入不超過總資金的 10%

**快速參考表：**

| 總資金 | 網格投入 | 趨勢單筆 | 趨勢倉位 | 總使用 | 預留 |
|--------|---------|---------|---------|--------|------|
| 100    | 60      | 10      | 2       | 80     | 20   |
| 200    | 120     | 20      | 2       | 160    | 40   |
| 300    | 180     | 30      | 2       | 240    | 60   |
| 500    | 300     | 50      | 2       | 400    | 100  |
| 1000   | 600     | 100     | 2       | 800    | 200  |

---

### **4. 配置文件對照表**

| 配置檔 | 配置項 | 用途 | 預設值 |
|--------|--------|------|--------|
| `exchange_config.js` | `EXCHANGE_NAME` | 選擇交易所 | 'binance' |
| `grid_bot_multi.js` | `investment` | 網格投入 | 180 USDT |
| `grid_bot_multi.js` | `leverage` | 網格槓桿 | 1 |
| `bot_multi.js` | `investmentPerTrade` | 趨勢單筆 | 15 USDT |
| `bot_multi.js` | `maxPositions` | 趨勢倉位 | 2 |
| `bot_multi.js` | `leverage` | 趨勢槓桿 | 1 |
| `calculate_profit_multi.js` | `initialInvestment` | 初始投入 | 180 USDT |

**重要區別：**
- 機器人的 `investment` / `investmentPerTrade` = 機器人**使用**的資金
- 收益計算的 `initialInvestment` = 您**實際轉入**交易所的總資金

**範例說明：**
```
您轉入交易所：300 USDT
├─ 網格機器人使用：180 USDT
├─ 趨勢機器人使用：60 USDT（2×30）
└─ 預留緩衝：60 USDT

配置：
grid_bot_multi.js: investment = 180
bot_multi.js: investmentPerTrade = 30, maxPositions = 2
calculate_profit_multi.js: initialInvestment = 300
```

---

## 🎮 啟動機器人
<a id="start-bots"></a>

### **方法 1：使用配置檔啟動（推薦）**

```bash
# 啟動所有機器人
pm2 start ecosystem.config.cjs

# 查看狀態
pm2 status

# 查看日誌
pm2 logs

# 重啟
pm2 restart all

# 停止
pm2 stop all
```

### **方法 2：單獨啟動**

```bash
# 單獨啟動市場掃描器
pm2 start market_scanner_multi.js --name "market-scanner"

# 單獨啟動趨勢機器人
pm2 start bot_multi.js --name "trend-bot"

# 單獨啟動網格機器人
pm2 start grid_bot_multi.js --name "grid-bot"
```

---

## 📖 使用指南
<a id="usage-guide"></a>

### **首次運行**

```bash
# 1. 啟動掃描器
pm2 start market_scanner_multi.js --name "scanner"

# 2. 等待 5-10 分鐘，確認 market_data.json 生成
ls -lh market_data.json

# 3. 啟動交易機器人
pm2 start bot_multi.js --name "trend-bot"
pm2 start grid_bot_multi.js --name "grid-bot"
```

---

### **修改投資成本**

#### **修改網格機器人投入**
```bash
# 1. 停止機器人
pm2 stop grid-bot

# 2. 編輯配置
nano grid_bot_multi.js
# 找到第 25 行：investment: 150
# 改成您想要的金額

# 3. 儲存（Ctrl+O）並退出（Ctrl+X）

# 4. 重啟
pm2 restart grid-bot
```

#### **修改趨勢機器人投入**
```bash
# 1. 停止機器人
pm2 stop trend-bot

# 2. 編輯配置
nano bot_multi.js
# 找到第 25 行：investmentPerTrade: 15
# 改成您想要的金額

# 3. 儲存並重啟
pm2 restart trend-bot
```

---

### **日常監控**

```bash
pm2 monit          # 即時監控
pm2 status         # 狀態查看
pm2 logs --lines 50  # 查看日誌
```

### **計算收益**

#### **步驟 1：配置初始投入**

在執行收益計算前，需要先設定您的投入成本：

```bash
nano calculate_profit_multi.js
```

找到第 44-48 行，修改配置：

```javascript
const CONFIG = {
    initialInvestment: 200,  // ← 改成您第一次轉入的金額
    
    additionalDeposits: [    // ← 如果有追加資金，記錄在這裡
        // { date: '2026-02-20', amount: 100 },
    ],
};
```

**配置說明：**

| 情況 | 配置方式 | 範例 |
|------|---------|------|
| 一次投入 | 只設定 initialInvestment | `initialInvestment: 200` |
| 分批投入 | 記錄所有追加資金 | 見下方範例 |

**範例 1：一次投入 200 USDT**
```javascript
const CONFIG = {
    initialInvestment: 200,
    additionalDeposits: [],
};
```

**範例 2：初始 150，後追加 100**
```javascript
const CONFIG = {
    initialInvestment: 150,
    additionalDeposits: [
        { date: '2026-02-18', amount: 100 },
    ],
};
```

**範例 3：多次追加**
```javascript
const CONFIG = {
    initialInvestment: 150,
    additionalDeposits: [
        { date: '2026-02-18', amount: 50 },
        { date: '2026-02-25', amount: 100 },
    ],
};
```

**⚠️ 重要提醒：**
- ✅ `initialInvestment` 是您**實際轉入交易所的總金額**
- ❌ 不是機器人配置中的 `investment` 或 `investmentPerTrade`
- ✅ 如果有追加資金，務必記錄在 `additionalDeposits` 中
- ❌ 否則收益率會被虛增

**如何確認設定正確？**
```bash
# 查看交易所充值記錄
# 資產 → 資金記錄 → 充值
# 加總所有 USDT 充值 = initialInvestment + Σ additionalDeposits
```

---

#### **步驟 2：執行收益計算**

```bash
node calculate_profit_multi.js
```

**輸出範例：**
```
============================================================
📊 當前交易所: BINANCE
============================================================
📊 網格機器人收益分析工具
============================================================

💰 查詢帳戶資產...
總資產: 215.50 USDT
可用: 180.30 USDT
占用: 35.20 USDT

💵 總體收益:
初始投入: 200.00 USDT
當前總資產: 215.50 USDT
總收益: +15.50 USDT
收益率: +7.75%

📈 查詢交易記錄...
已實現盈虧: +12.30 USDT
成交次數: 45 次
平均每次: +0.2733 USDT

📊 各幣種收益統計:
DUSKUSDT     | 收益: +12.30 USDT | 次數: 45 | 均: +0.2733

📅 收益率估算:
運行天數: 2 天
日均收益: 7.75 USDT
日收益率: 3.88%
年化收益率 (APY): 1416.70%
```

**收益計算公式：**
```
總投入 = initialInvestment + Σ additionalDeposits
淨收益 = 當前總資產 - 總投入
收益率 = (淨收益 / 總投入) × 100%
年化收益率 = ((1 + 日收益率) ^ 365 - 1) × 100%
```

### **切換交易所**

```bash
pm2 stop all
nano exchange_config.js  # 修改 EXCHANGE_NAME
pm2 restart all
```

---

## ❓ 常見問題
<a id="faq"></a>

### **Q: npm install 很慢？**

```bash
npm config set registry https://registry.npmmirror.com
npm install
```

---

### **Q: PM2 權限錯誤？**

**Windows:** 以管理員身份執行  
**Linux:** 使用 `sudo npm install -g pm2`

---

### **Q: .env 檔案無效？**

確認檔案名稱是 `.env` 而不是 `.env.txt`

```bash
# Linux
ls -la .env

# Windows
dir .env
```

---

### **Q: API 金鑰錯誤？**

檢查：
- ✅ 金鑰完整（無空格）
- ✅ .env 格式正確
- ✅ EXCHANGE_NAME 正確
- ✅ API 權限包含「交易」
- ✅ IP 白名單已設置

---

### **Q: 機器人一直重啟？**

```bash
pm2 logs --err  # 查看錯誤
```

常見原因：
- API 金鑰錯誤
- 網路問題
- 記憶體不足

---

## 🛡️ 安全建議
<a id="security"></a>

### **API 安全**

- ✅ 只開啟：讀取 + 交易權限
- ❌ 絕不開啟：提現權限
- ✅ 設置 IP 白名單
- ✅ 定期更換金鑰

### **檔案權限（Linux）**

```bash
chmod 600 .env        # 只有擁有者可讀
chmod 755 ~/crypto-bot
```

### **防火牆（Linux）**

```bash
sudo ufw enable
sudo ufw allow ssh
```

### **備份**

```bash
# 備份重要檔案
cp .env .env.backup
cp exchange_config.js exchange_config.backup.js
pm2 save
```

---

## 📊 效能監控

```bash
# PM2 監控
pm2 monit

# 清理日誌
pm2 flush

# 日誌輪替
pm2 install pm2-logrotate
```

---

## 📝 更新日誌

### v3.3 (2026-02-15)
- 🐛 修正網格機器人倉位累積問題：破網重置前自動平掉所有持倉，避免舊倉位疊加
- 🐛 修正補單沒有上限問題：補單前檢查總持倉名義價值，超過 `investment × leverage` 上限時停止補單
- ✅ 新增 `closeAllPositions()` 函數統一處理取消掛單與平倉邏輯

---

## ⚠️ 免責聲明

本軟體僅供學習研究。加密貨幣交易有高風險，可能損失全部投資。使用前請：

1. 充分了解交易風險
2. 在測試環境測試
3. 自行承擔所有風險

**使用即表示同意自行承擔責任。**

---

## 🎉 快速開始

選擇您的系統：
- [Windows 安裝](#-windows-安裝)
- [Linux 安裝](#-linux-安裝)
- [手機安裝 (Android)](#-手機安裝-android)

祝您交易順利！💰📈
