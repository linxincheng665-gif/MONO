# MONO 3.2 接口与数据说明

## 默认数据覆盖

| 数据 | Android 与 Windows 安装版默认覆盖 |
| --- | --- |
| 报价与历史走势 | 腾讯财经公开 A 股和美股报价、日线与 A 股分钟线。美股分钟线使用东方财富，当前支持 1 分钟。行情页面保留历史 CSV 导入、Alpaca 美股和自定义行情网关。 |
| 美股财报与公告 | SEC EDGAR 已识别标的的申报和常用财务数据，包括营收、净利润、每股收益和经营现金流。 |
| A 股财报与公告 | 东方财富财务数据，包括报告期累计营收、营收同比、归母净利润及经营现金流。沪市优先读取上交所原始公告，其他标的使用可用的东方财富公告。 |
| ETF | A 股 ETF 的单位净值与基金管理人公告由东方财富基金档案提供。美股 ETF 可读取 SEC 基金申报及能核验基金系列的 N-PORT 净资产、投资条目数等数据。SPY 另有 State Street 官方净值和总费用率。 |
| 宏观、新闻与情绪 | 美国财政部国债收益率及期限利差、纽约联储有效联邦基金利率、美国劳工统计局 CPI 与失业率。美股新闻使用 Yahoo Finance RSS，A 股新闻使用 Google 新闻 RSS。美股大盘情绪使用 CNN 恐惧与贪婪指数，暂缺时回退到 Cboe VIX。A 股市场宽度按东方财富指数行情的沪深上涨、下跌、平盘家数计算。个股标题统计只反映取得的新闻样本。 |

进入 **股票研究 → 数据 → 数据来源与时效** 查看来源链接、日期和「覆盖与可用性」。公告列表展示近期记录，可打开原文或进入披露档案查找更早的报告。行情刷新和披露时点取决于数据源。标的覆盖、估值和费率字段随来源而异，遇到接口限流、休市或数据缺失时，以页面显示的缓存、上次记录或暂缺状态为准。

## JSON 研究数据

- 在 **股票研究 → 数据 → 导入研究数据** 选择当前标的的 JSON 文件，最大 512,000 字节。导入记录与自动数据一起显示，可通过「移除导入快照」清除。
- 3.1 的 JSON 结构继续可用。顶层可含 `symbol`，填写时须与当前标的一致。五个可选数组为 `fundamentals`、`valuation`、`macro`、`events`、`sentiment`，可放在顶层或 `sections` 内。
- 每条至少提供 `label`（或 `title`）、`source`、HTTPS `url`，以及 `asOf` 或 `publishedAt`。日期可用 `YYYY-MM`、`YYYY-MM-DD` 或带时区的 ISO 时间。除事件外须有数值或文字 `value`。可附 `unit`、`detail` 和已识别的 `metric`，如以百分比填写的 `revenueGrowthPct`、`expenseRatioPct`，或带币种单位的 `navPerShare`。两种时间齐备更便于规则核验。
- 在同一页的 **数据设置** 可填写研究数据网关。网关以 HTTPS 接收 GET 和当前标的 `symbol` 参数，返回同一 JSON 结构，并允许下列应用来源跨域读取。

```json
{
  "symbol": "SPY",
  "events": [
    {
      "kind": "filing",
      "label": "基金 N-PORT 申报",
      "source": "SEC EDGAR",
      "url": "https://www.sec.gov/Archives/edgar/data/884394/000141036826089410/primary_doc.xml",
      "asOf": "2026-06-30",
      "publishedAt": "2026-08-28T16:25:47Z"
    }
  ]
}
```

## 自建模型接口

在 **量化实验室 → 外部模型 → 模型接口设置**，填入自有或已获授权的 HTTPS 接口和模型 ID。可填写基地址 `https://models.example.com/v1`，MONO 会补上 `/chat/completions`；也可填写完整路径 `https://models.example.com/v1/chat/completions`。地址须使用有效 TLS 证书。接口接收非流式 Chat Completions 请求并在 `choices[0].message.content` 返回正文。

可选访问令牌通过 `Authorization: Bearer` 发送，仅在当前应用会话内存中保留。只有点击 **生成外部分析** 才会发送当前标的和基于公开行情的量化摘要，包括数据时点、收益和风险统计、基准比较及纸面规则检验。持仓、成本、现金、账务和导入研究记录留在本机。模型服务的用量与费用由所选服务方决定。

服务端应逐个允许 `https://mono.android.local` 和 `https://mono.windows.local`。根据经校验的请求 `Origin` 回显单个允许的来源，并在预检和实际响应中提供 CORS 头。以下以 Android 请求为例，Windows 请求须回显对应来源。

```http
Access-Control-Allow-Origin: https://mono.android.local
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Authorization, Content-Type
Vary: Origin
```

`OPTIONS` 预检应直接返回成功。配置研究数据网关时，另需允许 `GET`。

## 研究与验证范围

- **投资机会**扫描内置的 20 只 A 股、美股与 ETF，可按市场或 ETF 筛选。结果随数据完整度和规则条件变化。
- **量化实验室 → 样本验证**按日线时间切分约 70% 训练区和 30% 留出区。启用参数选择时只用训练区比较候选参数，冻结后在一段留出区检验一次。信号按收盘确认、按下一交易日开盘模拟执行，并计入设置的单边成本。结果是纸面技术规则检验。
- **股票研究 → 跟踪**的价格、事件、策略失效和机会提醒保存在本机，应用前台运行时检查并在应用内显示。
