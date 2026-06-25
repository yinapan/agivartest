# Phase 4D 补充：Agivar 录屏附件数据模型参考

> 基于反编译 `attach_bar`、`attach`、`selectable` chunk 的实际数据结构逆向
> 直接服务于 Phase 4D 的 `ChatRecordingAttachment` 和 `chat-recording-store` 设计

---

## 一、Agivar 的录屏附件分类系统

Agivar 将录屏在 UI 层分为 **4 种 kind**，每种有完全不同的交互行为：

```typescript
// 从反编译还原的 GridItem kind 体系
type GridItemKind = 'server' | 'processing' | 'unprocessed' | 'interrupted';
```

| Kind | 含义 | 对应状态 | 用户可做什么 |
|---|---|---|---|
| `server` | 已完成 + 已同步到服务端 | rec_id + vid 都存在 | 查看、附加到聊天、删除 |
| `processing` | 正在处理中（上传/分析） | is_processing 或 is_queued | 查看进度、取消处理 |
| `unprocessed` | 已上传但未处理 | rec_id 存在，无 vid | 重新处理、附加后自动触发处理 |
| `interrupted` | 录制中断/只保存在本地 | 仅 local_id，无 rec_id | 继续录制或丢弃 |

### 关键设计决策

1. **interrupted 录制是本地独有的**——不占用服务端 ID，可以被恢复或丢弃
2. **processing 状态由 500ms 定时器轮询**——不是事件驱动，因为处理进度在后端
3. **unprocessed 在附加时自动触发 reprocess**——用户体验：选了就能用，不用手动触发

---

## 二、RecAttach 数据模型（精确还原）

```typescript
// Agivar 的录制附着物数据模型（从 payload_to_rec_attach 还原）
interface RecAttach {
  rec_id: string;           // 服务端录制 ID；本地录制用 "local:{id}"
  local_id?: string;        // 本地录制 ID（仅 interrupted 有）
  name: string;             // 录制名称
  duration: number;         // 秒
  processing: boolean;      // 是否正在处理
  queued?: boolean;         // 是否在处理队列中
  pct: number;              // 处理进度 0-100
  proc_start: number;       // 处理开始时间戳
  vid?: string;             // 视频 ID（processed 时有值）
}
```

### 与 Phase 4D 的 ChatRecordingAttachment 对比

| 字段 | Agivar RecAttach | Phase 4D ChatRecordingAttachment | 差异 |
|---|---|---|---|
| `rec_id` / `sessionId` | `string` | `string` | 一致，我们用了 sessionId |
| `name` / `title` | `string` | `string` | 一致 |
| `duration` / `durationSeconds` | `number`（秒） | `number?`（秒） | Phase 4D 多了 optional |
| `processing` / `status` | `boolean` + `queued` | `'generating' \| 'draft_ready' \| 'failed'` | Phase 4D 用枚举，更清晰 |
| `pct` / (缺失) | `0-100` | 无 | **Phase 4D 应增加进度百分比** |
| `proc_start` / (缺失) | `timestamp` | 无 | Phase 4D 可选增加 |
| (缺失) / `scope` | 无 | `'fullscreen' \| 'active-window'` | Phase 4D 新增，好的补充 |
| (缺失) / `privacyMode` | 无 | `'summary' \| 'detailed'` | Phase 4D 新增，好的补充 |
| (缺失) / `thumbnailPath` | 无 | `string?` | Phase 4D 新增 |
| (缺失) / `keyframeCount` | 无 | `number?` | Phase 4D 新增 |
| (缺失) / `warningCount` | 无 | `number?` | Phase 4D 新增 |

**建议**：Phase 4D 的 `ChatRecordingAttachment.status` 增加 `'queued'` 和 `'processing'` 两个中间状态，并增加 `processingPct?: number` 字段。当前 `generating` 太粗粒度。

---

## 三、附着物状态管理（Attach Bar 模式）

### 3.1 核心状态

```typescript
// Agivar 的附着物全局状态
const rec_attachs = new Map<string, RecAttach>();  // key: rec_attach_key()
const dismissed_rec_attach_ids = new Set<string>(); // 已关闭的附着物
const MAX_REC_ATTACH = 5;                           // 最多 5 个附着物
```

### 3.2 合并策略（`merge_rec_attachments`）

Agivar 的附着物合并算法：

```
merge_rec_attachments(payloads):
  1. 把新 payloads 转为 RecAttach
  2. 与现有 rec_attachs 合并（新覆盖旧）
  3. 如果总数超过 MAX_REC_ATTACH(5)，删除最旧的
  4. 如果有 server 录制（非 local:），清除该 rec_id 的 dismissed 标记
  5. 触发 UI 刷新：bump_attach_bar() + bump_composer()
```

### 3.3 对 Phase 4D 的建议

`chat-recording-store.ts` 应实现类似的合并逻辑：

```typescript
// packages/desktop/src/renderer/stores/chat-recording-store.ts

const MAX_CHAT_ATTACHMENTS = 5;

export function mergeRecordingAttachments(
  existing: Map<string, ChatRecordingAttachment>,
  incoming: ChatRecordingAttachment[],
): Map<string, ChatRecordingAttachment> {
  const merged = new Map(existing);

  for (const att of incoming) {
    const key = att.sessionId;
    // 新数据覆盖旧数据（进度、状态等会更新）
    merged.set(key, { ...merged.get(key), ...att });

    // 恢复被取消 dismiss 的附件
    if (att.status !== 'discarded') {
      clearDismissedFlag(att.sessionId);
    }
  }

  // 超出上限时移除最旧的
  if (merged.size > MAX_CHAT_ATTACHMENTS) {
    const keys = [...merged.keys()];
    for (const k of keys.slice(0, merged.size - MAX_CHAT_ATTACHMENTS)) {
      merged.delete(k);
    }
  }

  return merged;
}
```

---

## 四、处理进度轮询模式

Agivar 使用 **500ms 间隔** 轮询处理中的录制状态：

```typescript
// Agivar 模式（从 ensure_rec_proc_timer 还原）
function ensureRecProcTimer(refreshUI: () => void) {
  if (!recProcTimer) {
    recProcTimer = setInterval(() => {
      if (anyRecProcessing()) {
        refreshUI();  // 更新进度条
      } else {
        stopRecProcTimer();  // 无处理中则停掉定时器
      }
    }, 500);
  }
}
```

**设计要点**：
- 只有存在 `processing` 或 `queued` 状态的录制时才启动定时器
- 没有任何处理中的录制时自动停止
- 不是全局常驻定时器

### 对 Phase 4D 的建议

Phase 4D 的 draft 生成是本地操作（调 `buildManifest` + `generateDraft`），不依赖后端轮询。但如果后续引入了云端处理管线，应采纳此模式。

当前 Phase 4D 可以使用更简单的方式：直接通过 `RecordingTeach.generateDraft` 的 IPC 返回事件来更新进度，不需要轮询。

---

## 五、录制选择器设计（Selector 模式）

Agivar 有一个录制选择器 UI（从 `selectable` chunk 分析）：

### 5.1 选择器数据结构

```typescript
// Agivar 的 grid item（选择器中的每一项）
interface SelectorGridItem {
  kind: GridItemKind;
  key: string;          // "s:{rec_id}" | "p:{rec_id}" | "u:{rec_id}" | "i:{local_id}"
  item: LocalOrServerItem;
}

// 排序：按 started_at 降序（最新在前）
// 过滤：按名称搜索（normalize text: lowercase + remove 空格/斜杠/冒号/连字符）
```

### 5.2 选择限制

```typescript
const MAX_SELECTOR_SELECTION = 5;  // 一次最多选 5 个录制
```

### 5.3 附加上限

```typescript
const MAX_REC_ATTACH = 5;  // 聊天中最多显示 5 个录制附件
```

**两个限制独立**：选择器可以看全部，但一次只能选 5 个附到聊天中。

### 对 Phase 4D 的建议

Phase 4D 第一版不需要录制选择器（一次只录一个），但架构上应预留：
- `chat-recording-store` 的 `mergeRecordingAttachments` 已预留多附件合并逻辑
- 后续如果要支持"从历史录制中选择附加到聊天"，可直接复用选择器模式

---

## 六、与 Phase 4D 设计的对齐建议

### 6.1 ChatRecordingAttachment 增强

```typescript
// 建议的最终版本
export type ChatRecordingAttachment = {
  type: 'recording';
  sessionId: string;
  title: string;
  durationSeconds?: number;
  thumbnailPath?: string;
  scope: 'fullscreen' | 'active-window';
  privacyMode: 'summary' | 'detailed';
  status: 'recording' | 'stopped' | 'queued' | 'processing' | 'draft_ready' | 'failed' | 'discarded';
  // 新增字段
  processingPct?: number;     // 0-100，processing 时有效
  queued?: boolean;           // 是否在队列中
  keyframeCount?: number;
  warningCount?: number;
  startedAt?: number;         // 录制开始时间戳（用于排序）
};
```

### 6.2 状态转换图

```
                    ┌─→ discard ──→ [discarded]
                    │
[recording] ──stop──→ [stopped] ──generate──→ [queued] ──→ [processing] ──→ [draft_ready]
                         │                        │              │
                         │                        └── cancel ────┘
                         │                               │
                         └── fail ──→ [failed] ←─────────┘
```

### 6.3 附加行为建议

参考 Agivar 的 `attach_selected_recordings` 逻辑：

```typescript
// 附加录制到聊天时的自动行为
async function attachRecordingToChat(sessionId: string) {
  const att = getAttachment(sessionId);

  // 添加为聊天消息附件
  chatStore.addUserMessage({
    text: '我录制了一段操作',
    attachments: [att],
  });

  // 如果是 unprocessed，自动触发处理
  if (att.status === 'stopped') {
    updateAttachment(sessionId, { status: 'queued' });
    await buildManifestAndGenerate(sessionId);
  }

  // 如果有处理中的录制，启动进度更新
  if (hasProcessingAttachments()) {
    startProgressTracker();
  }
}
```

---

## 七、不应照搬的 Agivar 设计

以下模式识别出来了但不应纳入 Phase 4D：

| Agivar 模式 | 原因 |
|---|---|
| 服务端 `rec_id` 预分配 (`/api/v1/recording/allocate_id`) | Phase 4D 纯本地，直接用 nanoid |
| 云端处理管线 (`processing` / `queued` 状态) | Phase 4D 本地 `buildManifest` + `generateDraft` |
| 服务端缩略图 CDN 缓存 (`thumb_cdn_cache`) | Phase 4D 本地缩略图文件 |
| 录制格式迁移 (`recording_migration`) | 我们还没有旧格式需要迁移 |
| `.rz` 加密归档 | Phase 4D 不需要，直接存 keyframes 目录 |
| 多录制选择器 (selector grid) | Phase 4D 一次一个录制，不需要