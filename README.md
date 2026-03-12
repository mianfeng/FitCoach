# FitCoach

移动优先的长期健身计划助手。核心流程不是普通聊天，而是：

1. 配置长期计划与三分化模板
2. 每天主动生成“今天怎么练怎么吃”
3. 回填训练与饮食执行结果
4. 用短期记忆、知识库和调整提案支撑后续决策

## 已实现能力

- 长期计划编辑：目标、体重、角色、宏量参数、A/B/C 模板关键字段
- 今日处方：按 A/B/C 顺延生成训练卡和饮食卡，同一天重复提问默认复用快照
- 日报回填：记录体重、睡眠、疲劳、动作表现，并自动生成短期记忆
- 调整提案：高疲劳 / 增肌体重变化异常时生成待确认提案
- 理论问答：结合知识库、近期执行记录和正式计划回答问题
- 双后端模式：
  - `Mock`：默认可直接运行，适合本地演示
  - `Supabase`：配置环境变量后使用持久化数据库
- 运行状态检查：`/setup` 页面与 `GET /api/status` 可直接查看当前是否已具备长期使用条件

## 技术栈

- Next.js 16 + App Router
- TypeScript
- Tailwind CSS 4
- Supabase（可选）
- Gemini API（可选）
- Vitest

## 本地启动

当前项目在 `fitcoach-web` 目录。

```bash
cd H:\other\workspeace\FitCoach\fitcoach-web
npm install
npm run dev
```

你当前机器已经创建了 Conda 环境 `fitcoach`，Node 20 已装在这个环境里。若继续沿用当前方式，命令可通过该环境执行。

## 环境变量

复制 `.env.example` 为 `.env.local`，按需填写：

```env
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.0-flash
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
FITCOACH_ACCESS_TOKEN=
```

说明：

- 不填 Supabase：应用自动进入 Mock 模式，数据只在当前开发进程内保存
- 填了 Supabase：应用改用数据库持久化
- 不填 Gemini：问答接口会退回到规则化回答，不会阻塞使用
- 填 `FITCOACH_ACCESS_TOKEN`：公网部署时启用单用户访问门禁

## Supabase 初始化

在 Supabase SQL Editor 执行：

- [supabase/schema.sql](/H:/other/workspeace/FitCoach/fitcoach-web/supabase/schema.sql)

然后设置 Vercel / 本地环境变量 `SUPABASE_URL` 与 `SUPABASE_SERVICE_ROLE_KEY`。

## 知识库导入

默认知识库文件位于：

- [content/knowledge/fitness-core-theory.md](/H:/other/workspeace/FitCoach/fitcoach-web/content/knowledge/fitness-core-theory.md)

导入方式：

```bash
npm run knowledge:import
```

或直接调用：

- `POST /api/knowledge/import`
- `GET /api/status`

## 关键接口

- `POST /api/plan/setup`
- `POST /api/daily-brief/generate`
- `POST /api/session-report`
- `POST /api/assistant/chat`
- `POST /api/plan-adjustments/:id/approve`
- `POST /api/knowledge/import`

## 验证命令

```bash
npm run lint
npm run test
npm run build
```

当前这三项都已通过。
