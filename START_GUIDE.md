# DeepSeek Harness Windows 启动脚本

## 脚本说明

本项目提供了多个 Windows 批处理脚本，用于简化 DeepSeek Harness 的启动过程：

### 1. `check-env.bat` - 环境检查脚本
**用途：** 检查开发环境是否正确配置

**功能：**
- 检查 Node.js 版本
- 检查 pnpm 安装状态
- 检查 Git 安装状态（可选）
- 验证项目结构完整性
- 提供详细的诊断信息

**使用方法：**
```batch
# 双击运行或在命令行中执行
check-env.bat
```

### 2. `start.bat` - 完整启动脚本
**用途：** 首次启动或需要完整设置时使用

**功能：**
- 检查 Node.js 版本（要求 ^22.19.0 或 >=24.0.0）
- 检查并安装 pnpm
- 安装项目依赖
- 构建项目
- 启动 Web 界面

**使用方法：**
```batch
# 双击运行或在命令行中执行
start.bat
```

### 3. `quick-start.bat` - 快速启动脚本
**用途：** 已完成首次设置后的日常启动

**功能：**
- 跳过依赖安装和构建步骤
- 直接启动 Web 界面
- 适合已安装依赖并构建过项目的情况

**使用方法：**
```batch
# 双击运行或在命令行中执行
quick-start.bat
```

### 4. `dev-start.bat` - 开发模式启动脚本
**用途：** 开发调试时使用

**功能：**
- 启动开发服务器，支持热重载
- 修改代码后自动刷新
- 适合开发和测试

**使用方法：**
```batch
# 双击运行或在命令行中执行
dev-start.bat
```

### 5. `stop.bat` - 停止服务脚本
**用途：** 停止正在运行的 DeepSeek Harness 进程

**功能：**
- 停止所有相关的 Node.js 进程
- 停止所有相关的 pnpm 进程
- 清理运行环境

**使用方法：**
```batch
# 双击运行或在命令行中执行
stop.bat
```

**注意：** 也可以在运行启动脚本的窗口中按 `Ctrl+C` 来停止服务。

## 推荐使用流程

### 首次使用流程：
1. 运行 `check-env.bat` 检查环境
2. 运行 `start.bat` 进行完整设置和启动

### 日常使用流程：
- 使用 `quick-start.bat` 快速启动

### 开发调试流程：
- 使用 `dev-start.bat` 启动开发模式

### 停止服务：
- 在启动窗口按 `Ctrl+C` 或运行 `stop.bat`

## 前置要求

### Node.js
- 下载地址：https://nodejs.org/
- 要求版本：^22.19.0 或 >=24.0.0

### Git（可选）
- 如果从源代码运行需要 Git
- 下载地址：https://git-scm.com/

## 中文编码问题处理

所有脚本都包含了以下编码处理：

```batch
@echo off
REM 设置 UTF-8 编码以正确处理中文字符
chcp 65001 >nul 2>&1
```

这确保了在 Windows 命令行中：
- 中文提示信息正常显示
- 中文路径和文件名正确处理
- 避免乱码问题

## 故障排除

### 问题1：Node.js 版本过低
**解决方案：** 升级到要求的 Node.js 版本

### 问题2：pnpm 安装失败
**解决方案：**
```batch
# 手动安装 pnpm
npm install -g pnpm
```

### 问题3：端口冲突
**解决方案：**
```batch
# 使用不同端口启动
pnpm dsh web --port 8080
```

### 问题4：构建失败
**解决方案：**
```batch
# 清理并重新构建
pnpm run clean
pnpm install
pnpm run build
```

## 手动启动（如果脚本失败）

如果脚本运行有问题，可以手动执行以下命令：

```batch
# 1. 设置 UTF-8 编码
chcp 65001

# 2. 安装依赖
pnpm install

# 3. 构建项目
pnpm run build

# 4. 启动 Web 界面
pnpm dsh web
```

## 访问地址

启动成功后，Web 界面默认地址为：
```
http://127.0.0.1:3080
```

## 停止服务

在命令行窗口中按 `Ctrl + C` 停止服务。

## 更多信息

- 项目主页：https://github.com/deepseek-ai/deepseek-harness
- 文档：查看项目根目录下的 README.md
- 问题反馈：https://github.com/deepseek-ai/deepseek-harness/issues
