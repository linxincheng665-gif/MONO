# MONO

MONO 是面向个人投资者的研究终端，支持 Web、Android 和 Windows。当前源码版本为 3.3.2。

## 功能

- **资产与持仓**：管理现金、碎股、持仓成本和浮动盈亏，查看资产配置与组合走势。
- **行情与机会**：维护 A 股和美股自选，查看 K 线、MA20、MA50 和 RSI。用默认或自定义投资计划筛选标的，可设定范围、周期、趋势和数值门槛。自定义名单最多支持 300 个标的。
- **投资研究**：查看技术、财报、估值与事件依据。研究结果列出条件、失效价和数据限制。
- **交易与风险**：估算仓位、止盈止损和盈亏比，对组合做市场压力测试及调仓模拟。
- **量化实验室**：运行本地规则分析与验证。可按需连接自有模型服务。

## 运行 Web 版

安装 Node.js 22 或更新版本，然后从仓库根目录启动 Web 服务。

```sh
npm start
```

打开 `http://127.0.0.1:4173`。Web 版无需安装 npm 依赖。端口可通过 `MONO_PORT` 设置。

## 构建 Android 和 Windows 版

两端的构建脚本直接打包根目录的共享界面和研究引擎。以下命令在 Windows PowerShell 中运行。

### Android

准备 JDK、Android SDK Platform 35 和 Build Tools 35.0.0，设置 `JAVA_HOME` 与 `ANDROID_HOME`。应用最低支持 Android 6.0（API 23）。

```powershell
.\android\build.ps1
```

脚本会在本机创建用于签名的文件，并在仓库根目录生成 `MONO-3.3.2.apk`。更新本机此前构建的 APK 时，需使用原签名。

### Windows x64

准备 .NET Framework 4.x 编译器、Microsoft Edge WebView2 Runtime，以及 Microsoft.Web.WebView2 SDK 的 NuGet 包。构建脚本使用 SDK 内的 `lib/net462` 和 `build/native/x64` 文件。现有 Windows 版使用 [WebView2 SDK 1.0.4370.26](https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.4370.26)。

```powershell
.\windows\build.ps1 -WebViewPackage "C:\path\to\Microsoft.Web.WebView2.nupkg"
```

解压生成的 `MONO-3.3.2-Windows.zip`，打开 `MONO.exe`。

## 数据与配置

行情页支持 CSV 导入、自定义行情网关与原生端 Alpaca 接入。研究页显示可取得的数据来源、时点及覆盖情况，并支持导入研究资料。公网数据的可用性与时效以各数据源为准，Web 版也受浏览器跨域规则约束。

持仓与配置保存在本机。外部模型服务可选，配置后由用户主动调用。接口与研究数据格式可参考以下版本文档。

- [3.2 接口与数据说明](MONO-3.2-接口与数据说明.md)
- [3.1 研究数据导入说明](MONO-3.1-研究数据.md)

## 许可证

MONO 源码采用 [MIT](LICENSE) 许可证。Inter 字体按 [SIL Open Font License 1.1](Inter-OFL.txt) 提供。行情、财报及模型服务适用各自的使用条款。
