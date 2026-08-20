# DeepSeek Harness Windows 一键启动脚本

## 📋 脚本清单

本项目为 Windows 用户提供了完整的一键启动解决方案，解决了命令行中文编码问题：

### 🔧 核心脚本

| 脚本文件 | 功能描述 | 使用场景 |
|---------|---------|---------|
| `check-env.bat` | 环境检查 | 首次使用前检查环境配置 |
| `start.bat` | 完整启动 | 首次启动或需要重新构建 |
| `quick-start.bat` | 快速启动 | 日常使用（已完成构建） |
| `dev-start.bat` | 开发模式 | 开发调试（热重载） |
| `stop.bat` | 停止服务 | 停止所有相关进程 |

## 🚀 快速开始

### 第一次使用：
```batch
# 1. 检查环境
check-env.bat

# 2. 首次启动（包含依赖安装和构建）
start.bat
```

### 日常使用：
```batch
# 快速启动（跳过安装和构建）
quick-start.bat
```

### 开发调试：
```batch
# 开发模式（支持热重载）
dev-start.bat
```

### 停止服务：
```batch
# 方式1：在启动窗口按 Ctrl+C
# 方式2：运行停止脚本
stop.bat
```

## 🔤 中文编码问题解决

所有脚本都包含了以下编码处理：

```batch
@echo off
REM 设置 UTF-8 编码以正确处理中文字符
chcp 65001 >nul 2>&1
```

这确保了：
- ✅ 中文提示信息正常显示
- ✅ 中文路径和文件名正确处理
- ✅ 避免控制台乱码问题
- ✅ 错误信息清晰可读

## 📋 环境要求

- **Node.js**: ^22.19.0 或 >=24.0.0
- **pnpm**: 11.7.0 或更高版本
- **操作系统**: Windows 10/11
- **Git**: 可选，用于版本控制

## 🎯 脚本功能详解

### check-env.bat
- 检查 Node.js 版本
- 检查 pnpm 安装状态
- 检查项目结构完整性
- 提供详细的诊断信息

### start.bat
- 自动检查 Node.js 版本
- 自动安装 pnpm（如需要）
- 安装项目依赖（pnpm install）
- 构建项目（pnpm run build）
- 启动 Web 界面（pnpm dsh web）

### quick-start.bat
- 跳过依赖安装和构建步骤
- 直接启动 Web 界面
- 适合已完成的开发环境

### dev-start.bat
- 启动开发服务器
- 支持热重载功能
- 修改代码后自动刷新

### stop.bat
- 优雅停止所有相关进程
- 清理运行环境
- 避免端口占用问题

## 🌐 访问地址

启动成功后，Web 界面地址：
```
http://127.0.0.1:3080
```

## 🛠️ 故障排除

### 问题：Node.js 版本不兼容
```batch
# 解决方案：升级 Node.js
# 访问 https://nodejs.org/ 下载最新版本
```

### 问题：pnpm 安装失败
```batch
# 手动安装 pnpm
npm install -g pnpm
```

### 问题：端口冲突
```batch
# 使用不同端口启动
pnpm dsh web --port 8080
```

### 问题：构建失败
```batch
# 清理并重新构建
pnpm run clean
pnpm install
pnpm run build
```

## 📝 手动启动（备用方案）

如果脚本运行有问题，可以手动执行：

```batch
# 设置 UTF-8 编码
chcp 65001

# 安装依赖
pnpm install

# 构建项目
pnpm run build

# 启动 Web 界面
pnpm dsh web
```

## 🔗 相关链接

- **项目地址**: https://github.com/deepseek-ai/deepseek-harness
- **文档**: 查看 `START_GUIDE.md` 获取详细使用说明
- **问题反馈**: https://github.com/deepseek-ai/deepseek-harness/issues

## 📌 注意事项

1. 首次运行建议使用 `check-env.bat` 检查环境
2. 开发模式需要完整构建后才能使用
3. 停止服务时建议使用 Ctrl+C 而不是直接关闭窗口
4. 如遇问题，查看错误信息的颜色标识：
   - 🔴 ERROR: 需要立即处理的错误
   - 🟡 WARNING: 警告信息，可继续运行
   - 🟢 SUCCESS: 操作成功
   - 🔵 INFO: 一般信息

---

**创建日期**: 2026-08-19
**版本**: 1.0
**适用于**: DeepSeek Harness v0.1.0-rc.5+
