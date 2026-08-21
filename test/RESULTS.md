# 测试结果

执行日期：2026-08-21

## 类型检查

命令：

```text
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
```

结果：通过，退出码 0。

## 行为测试

命令：

```text
node --experimental-strip-types --test test/fs-plugin-utils.test.ts
```

结果：通过，8 个测试通过，0 个失败。

测试覆盖：隐藏文件、目录优先排序、目录读取、懒加载树扁平化、文件大小格式化、文本/图像识别、无扩展名内容探测和轻量着色。

说明：当前环境没有全局 `bun` 命令，因此使用项目本地 TypeScript 和 Node 24 的原生 TypeScript 擦除模式完成验证。
