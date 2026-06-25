# 录制存储与数据生命周期设计参考

> 基于 Agivar `archiver`、`sync_task`、`recording_migration` chunk 的存储模式逆向
> 服务于 Phase 3 录制存储、Phase 4C 录制历史管理

---

## 一、Agivar 录制存储架构

### 1.1 双层存储模型

Agivar 的录制数据分两层：

```
本地层（~/.agivar/datas/screen_recordings/）
├── {rec_id}.rz              ← 加密归档（已完成录制的主格式）
├── {rec_id}.rz.pending      ← 同步标记（上传中）
├── {rec_id}.rz.vid          ← 视频元信息 sidecar
├── {rec_id}.thumb.jpg       ← 缩略图
├── .tmp_rec_{id}/           ← 录制中临时目录
│   └── original/
│       ├── live.json        ← 实时录制状态
│       ├── audio.wav        ← 音频
│       └── annotations.json ← 注释
└── .tmp_{id}/               ← 通用临时目录

服务端层（通过 API 同步）
├── 上传：/api/v1/recording/upload_presign（预签名上传）
├── 分配 ID：/api/v1/recording/allocate_id
├── 视频 CRUD：/api/v1/video/*
└── 批量删除：/api/v1/video/batch_delete
```

### 1.2 .rz 归档格式（从 archiver chunk 还原）

```typescript
// Agivar 的自定义录制归档格式
interface RzArchive {
  header: {
    // read_rz_header_from_file() 读取
    // 包含元信息、帧索引、加密参数
  };
  body: {
    // decrypt_rz_body() 解密
    // 包含压缩后的帧数据
  };
  // read_rz_first_frame_jpeg() — 快速提取首帧缩略图
  // read_rz_meta_from_file() — 只读元信息不解压
}

// 加密方案
const defaultHttpAesKey: string;  // derive_rz_key() 派生密钥
const xor_bytes: (a: Uint8Array, b: Uint8Array) => Uint8Array;
const sha256: (data: Uint8Array) => string;

// 归档函数
function archive_original_dir(sourceDir: string, outputRzPath: string): void;
function unpack_rz_to_original_dir(rzPath: string, targetDir: string): void;
```

**设计要点**：
- 元信息和帧数据分离存储——可以只读 meta 不加载全部帧
- 首帧独立可读——用于快速生成缩略图
- AES 加密——录制内容在磁盘上不是明文
- 归档是单向操作——录制完成后从 `original/` 目录打包为 `.rz`

### 1.3 录制同步调度（从 sync_task 还原）

```typescript
// 同步任务配置
const SYNC_STARTUP_DELAY_MS: number;  // 启动后延迟同步
const sync_round_interval_ms: number;  // 同步间隔（自适应）

// 同步状态
const archiving: Set<string>;   // 正在归档中的 rec_id
const busy_rec_ids: Set<string>;  // 正在上传中的 rec_id
const uploading: Set<string>;     // 上传中

// 核心流程
async function run_sync_once(): Promise<void> {
  // 1. 列出本地 .rz 文件（list_local_rz_rec_ids）
  // 2. 对每个未上传的录制：
  //    a. 读取 vid sidecar（read_vid_sidecar）
  //    b. 如果没有 vid，从 rz meta 构建视频信息（build_video_info_from_rz_meta）
  //    c. 上传到服务端
  //    d. 写入 pending marker
  // 3. 孤儿 .rz 修复（run_orphan_rz_repair）— 没有对应原始目录的 .rz
  // 4. sleep(sync_round_interval_ms) 后重新调度
}

function schedule_recording_sync_task(): void;
function stop_recording_sync_task(): void;
```

### 1.4 录制格式迁移（从 recording_migration 还原）

```typescript
const LEGACY_MIGRATION_BATCH_PER_ROUND = 2;  // 每轮最多迁移 2 个旧录制

async function run_legacy_recording_migration(): Promise<void> {
  // 1. list_legacy_rec_dirs() — 列出旧格式录制目录
  // 2. load_processed_info() — 加载已处理信息（断点续迁）
  // 3. 每轮最多处理 2 个旧录制
  // 4. 对每个旧录制：
  //    a. build_migration_video_info() — 构建新格式元信息
  //    b. ensure_backend_index_from_meta() — 上传索引
  //    c. write_pending_marker() — 标记已迁移
  //    d. rm_rec_dir() — 删除旧目录（异常安全：is_not_found_error 忽略）
  // 5. yield_event_loop() — 每批之间让出事件循环
}
```

**设计要点**：
- 批量迁移 + 断点续迁——不会一次性卡住主线程
- 每批之间 `yield_event_loop()`——保证 UI 响应
- 删除旧目录前已确保新格式可用——不会丢失数据
- 异常安全——文件不存在的错误被静默处理

---

## 二、对我们项目的建议

### 2.1 Phase 3 录制存储设计

```
推荐目录结构（~/.agivar/recordings/）
├── {rec_id}/
│   ├── meta.json              ← 录制元信息（替代 live.json）
│   ├── events.jsonl           ← 事件流（每行一个 JSON）
│   ├── annotations.json       ← 用户注释
│   ├── keyframes/
│   │   ├── frame_00001.png
│   │   ├── frame_00002.png
│   │   └── ...
│   ├── thumb.jpg              ← 缩略图（首个 keyframe 的缩小版）
│   └── audio.wav              ← 音频（可选，Phase 4B+）
├── {rec_id}.zip               ← 归档文件（Phase 4C+，可选）
└── .trash/                    ← 待清理目录
    └── {rec_id}.deleted       ← 删除标记
```

### 2.2 meta.json 格式

```typescript
interface RecordingMeta {
  id: string;
  title: string;
  scope: 'fullscreen' | 'active-window';
  privacyMode: 'summary' | 'detailed';
  screenInfo: {
    width: number;
    height: number;
    dpiScale: number;
    monitorId: string;
  };

  // 录制时间线
  startedAt: string;       // ISO 8601
  stoppedAt?: string;
  durationMs?: number;

  // 帧统计
  totalFrames: number;
  keyframeCount: number;
  droppedFrames: number;

  // 事件统计
  totalEvents: number;
  annotationCount: number;

  // 生成状态
  generation?: {
    provider: string;
    status: 'pending' | 'manifesting' | 'generating' | 'done' | 'failed';
    manifestConfirmed: boolean;
    draftGenerated: boolean;
    workflowDraftPath?: string;  // generated/workflow_draft.json
    error?: string;
  };

  // 清理
  archived?: boolean;
  archivePath?: string;
  deletedAt?: string;
}
```

### 2.3 孤儿清理（Phase 4C 已规划，补充实现参考）

参考 Agivar 的 `run_orphan_rz_repair` 模式：

```typescript
// packages/core/src/memory/recording-cleanup.ts

export interface OrphanRecord {
  type: 'tmp_dir' | 'incomplete_recording' | 'dangling_archive' | 'broken_meta';
  path: string;
  sizeBytes: number;
  ageHours: number;
}

/**
 * 扫描录制目录，发现孤儿数据
 * 参考 Agivar 的 run_orphan_rz_repair + list_local_rz_rec_ids
 */
export async function findOrphans(recordingsDir: string): Promise<OrphanRecord[]> {
  const orphans: OrphanRecord[] = [];
  const entries = await fs.readdir(recordingsDir, { withFileTypes: true });
  const now = Date.now();

  for (const entry of entries) {
    const fullPath = path.join(recordingsDir, entry.name);

    // .tmp_rec_* 超过 24 小时未修改 → 孤儿
    if (entry.name.startsWith('.tmp_rec_') && entry.isDirectory()) {
      const stat = await fs.stat(fullPath);
      const ageHours = (now - stat.mtimeMs) / 3600000;
      if (ageHours > 24) {
        orphans.push({
          type: 'tmp_dir',
          path: fullPath,
          sizeBytes: await dirSize(fullPath),
          ageHours,
        });
      }
    }

    // 有 events.jsonl 但没有 meta.json → 不完整录制
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      const hasEvents = await fileExists(path.join(fullPath, 'events.jsonl'));
      const hasMeta = await fileExists(path.join(fullPath, 'meta.json'));
      if (hasEvents && !hasMeta) {
        const stat = await fs.stat(fullPath);
        orphans.push({
          type: 'incomplete_recording',
          path: fullPath,
          sizeBytes: await dirSize(fullPath),
          ageHours: (now - stat.mtimeMs) / 3600000,
        });
      }
    }

    // .zip 归档没有对应原始目录 → 悬挂归档
    if (entry.name.endsWith('.zip')) {
      const recId = entry.name.replace('.zip', '');
      const originalExists = entries.some(e => e.name === recId && e.isDirectory());
      if (!originalExists) {
        const stat = await fs.stat(fullPath);
        orphans.push({
          type: 'dangling_archive',
          path: fullPath,
          sizeBytes: stat.size,
          ageHours: (now - stat.mtimeMs) / 3600000,
        });
      }
    }
  }

  return orphans;
}
```

### 2.4 录制同步（后续云端阶段参考）

Agivar 的同步模式值得保留参考：

```typescript
// 后续云端阶段的录制同步接口（当前不实现）
interface RecordingSyncService {
  // 列出待同步的录制
  listPendingSync(): Promise<string[]>;

  // 单轮同步（参考 run_sync_once）
  syncOnce(): Promise<SyncRoundResult>;

  // 孤儿修复
  repairOrphans(): Promise<OrphanRepairResult>;

  // 调度（参考 schedule_recording_sync_task）
  startAutoSync(intervalMs: number): void;
  stopAutoSync(): void;
}

interface SyncRoundResult {
  uploaded: number;
  failed: number;
  skipped: number;
  errors: Array<{ recId: string; error: string }>;
}
```

---

## 三、录制生命周期完整状态机

```
                        ┌──────────────────────────────────────┐
                        │           录制完整生命周期              │
                        └──────────────────────────────────────┘

[IDLE]
  │ start()
  ▼
[RECORDING] ──────────────────────────────────────────────────────
  │  ├── frame capture loop
  │  ├── event capture
  │  ├── annotation input
  │  └── audio capture (Phase 4B+)
  │
  │ stop()                              cancel()
  ▼                                      ▼
[STOPPED]                            [CANCELLED]
  │                                      │
  │ preflight()                          │ discard()
  ▼                                      ▼
[PREFLIGHT_DONE]                     [DISCARDED]
  │                                      │
  │ buildManifest()                      │ cleanup()
  ▼                                      ▼
[MANIFEST_READY] ←── 用户确认 ──┐    [CLEANUP_DONE]
  │                              │
  │ generateDraft()              │ reprocessDraft()
  ▼                              │
[GENERATING] ── error ──→ [FAILED] ──┘
  │
  │ success
  ▼
[DRAFT_READY] ── discard() ──→ [DISCARDED]
  │
  │ (Phase 4C+) archive()
  ▼
[ARCHIVED] ── unpack() ──→ [DRAFT_READY]
```

---

## 四、录制大小与清理策略

### 4.1 存储估算

| 项目 | 典型大小 | 说明 |
|---|---|---|
| Keyframe PNG (1920×1080) | ~200-500 KB/帧 | 取决于画面复杂度 |
| Keyframe PNG (窗口级, ~800×600) | ~50-150 KB/帧 | 窗口截图更小 |
| events.jsonl | ~1-5 KB/分钟 | 取决于操作频率 |
| audio.wav (16kHz mono) | ~1.9 MB/分钟 | Phase 4B+ |
| meta.json | ~1 KB | 固定 |

**示例**：5 分钟录制，5fps 窗口级截图 = 5×60×5 = 1500 帧 × 100KB ≈ 150MB

### 4.2 清理触发器

参考 Agivar 的实现：
- 录制取消时立即清理 `.tmp_rec_*`
- 录制 discard 时删除原始目录
- 归档后可选删除原始目录
- 应用退出时强制清理所有临时目录（`forceStopAllRecordings`）
- 设置中的 `clear_cache` 调用清理所有录制数据

```typescript
// 清理触发器注册
app.on('before-quit', async () => {
  await forceCleanupAllRecordings();
});

app.on('window-all-closed', async () => {
  await forceCleanupAllRecordings();
});
```

---

## 五、不应照搬的 Agivar 设计

| Agivar 模式 | 替代方案 |
|---|---|
| 自定义 `.rz` 加密格式 | Phase 4D 直接存 keyframes 目录 + events.jsonl；归档用标准 `.zip` |
| AES 密钥派生（`derive_rz_key`） | 第一版不需要加密，Phase 4 后可用简单的 zip + 可选密码 |
| 服务端 ID 预分配 | 本地 nanoid |
| 录制格式迁移系统 | 等有旧格式时再实现 |
| 云端同步管线 | Phase 4D 后置 |
| 孤儿 .rz 修复 | 改为孤儿目录清理（更简单） |