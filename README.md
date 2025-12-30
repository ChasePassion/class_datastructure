# 项目蓝图：Nexus（社交网络涌现模拟器）v2（Minimal Necessary）

## 1. 核心模型定义 (The Core Model)

这是模拟的“物理法则”，不可更改。

### 1.1 个体数据结构 (Agent Interface)

> **关键变化（最小必要）**
>
> * 兴趣维度从 5 扩到 **12**（仍用二进制向量，保持简单）
> * 好感度 `affinity` 从无向变为**有向**：`F_ij` 表示 i 对 j
> * `connections` 保留，但明确为“**引擎每次重建的无向快照**”，不允许 UI/外部手动维护
> * 为了让噪声不抖：加一个极简的 `wander`（方向 + 倒计时）

```ts
// src/types/index.ts
export type Gender = 'Male' | 'Female';

export type InterestTag =
  | 'Technology'
  | 'Art'
  | 'Sports'
  | 'Politics'
  | 'Finance'
  | 'Music'
  | 'Movies'
  | 'Gaming'
  | 'Fitness'
  | 'Travel'
  | 'Food'
  | 'Reading';

export const INTEREST_DIM = 12;

export interface Vec2 {
  x: number;
  y: number;
}

export interface WanderState {
  dir: Vec2;       // 平滑噪声方向（单位向量）
  ttl: number;     // 方向剩余时间（秒）
}

export interface Agent {
  // 静态属性
  id: string;
  name: string; // 如 "User-1024"
  age: number;  // 18 - 65
  gender: Gender;

  // 兴趣：长度为12的二进制向量（0/1）
  // 例如：Technology + Gaming + Travel => [1,0,0,0,0,0,0,1,0,1,0,0]
  interests: number[];

  // 动态属性
  position: Vec2;
  velocity: Vec2;

  // 社交属性（有向好感）
  // Key: otherAgentId, Value: [-1.0, 1.0]
  affinity: Map<string, number>;

  // 无向连接快照（由引擎根据 affinity 互惠阈值重建）
  connections: string[];

  // 平滑随机游走（避免每帧随机抖动）
  wander: WanderState;
}
```

---

### 1.2 动力学规则 (Simulation Rules)

> **关键变化（最小必要）**
>
> 1. 不再“每帧固定更新”，改为**按 dt（秒）更新**（帧率变化不改变社会规律）
> 2. 删除独立 Triadic Closure 规则（会导致网络爆炸），改为“共同好友作为匹配因子”
> 3. 好感度既能升也能降：加入**拥挤惩罚（太近会烦）**这一条最有效负反馈
> 4. 运动稳定：阻尼 + 限速 + 软化排斥 + 平滑 wander

#### 规则 A：好感度演化 (Directed Affinity Evolution, dt-based)

对任意 i、j，若距离 `d(i,j) <= R`（感知半径）：

1. **计算匹配分 `match(i,j)`（0~1）**
   匹配分由四项组成（最小必要：兴趣、年龄、性别、共同好友）：

* 兴趣相似（Cosine，平滑）：`interestSim ∈ [0,1]`
* 年龄接近：`ageSim = exp(-|age_i-age_j|/ageScale) ∈ [0,1]`
* 性别偏好（极简）：`genderPref ∈ [0,1]`（默认轻微偏好异性，完全可调）
* 共同好友饱和：`mutualSim = mutual / (mutual + 3) ∈ [0,1]`

[
match = w_I\cdot interestSim + w_A\cdot ageSim + w_G\cdot genderPref + w_M\cdot mutualSim
]

2. **拥挤惩罚 `crowd(i,j)`（0~1）**
   若 `d < personalSpace`，则
   [
   crowd = clamp((personalSpace - d)/personalSpace, 0, 1)
   ]
   否则 `crowd=0`

3. **有向好感更新 `F_ij`（含遗忘）**

* 把 `match` 转成有正有负的驱动项：`signedMatch = 2*(match-0.5) ∈ [-1,1]`
* 遗忘：向 0 回归（简洁且稳定）

[
F_{ij} \leftarrow clamp\Big(F_{ij}\cdot e^{-\lambda dt} + dt\cdot(\eta\cdot signedMatch - \gamma\cdot crowd)\Big)
]

4. **无向连接重建（互惠 + 滞回）**
   不允许直接 `push/pop connections`，必须由引擎统一重建：

* 建边阈值 `T_on`
* 断边阈值 `T_off`（小于 `T_on`，防止闪断）

建边（无向）：
`F_ij > T_on && F_ji > T_on`

断边：
`F_ij < T_off || F_ji < T_off`

---

#### 规则 B：三元闭包（删除独立规则，合并到 match 的 mutualSim）

> **最小必要原则**：不单独做 “每帧 +0.001”，避免全图爆炸。
> 共同好友只作为 `match` 的一项，且仅在“接触半径内”才生效。

---

#### 规则 C：社会力运动 (Stable Social Force Movement, dt-based)

加速度由三部分组成：

1. **排斥力**（软化 + 线性推开，避免力爆炸）
   当 `d < sepRange`，按重叠程度推开。

2. **好友吸引力**（只对 `connections` 生效，弱吸引）

3. **平滑随机游走 wander**（每 0.5~1.2 秒换一次方向，不抖）

并加入三项稳定措施（最小必要）：

* 阻尼：`v *= exp(-drag*dt)`
* 限速：`|v| <= vMax`
* 边界反弹：带损耗 `restitution < 1`

---

### 2.1 目录结构

```text
/src
  /components
    /simulation
      SocialGraph.tsx      // Canvas 渲染 + 交互（选人/模式）
      ControlPanel.tsx     // 左侧控制栏（模式/按钮/TopN）
      StatsCard.tsx        // 统计卡片（节点数/边数/连通分量等）
      AgentInspector.tsx   // 右下角浮层：展示选中Agent详情
    /ui
      Button.tsx
      Card.tsx
  /lib
    simulationEngine.ts    // 纯逻辑层（dt step + 图快照 + 实验API）
    utils.ts               // 数学工具（cosine/clamp/dist等）
  /types
    index.ts
  app
    page.tsx
```

---

### 2.2 核心类逻辑 (`simulationEngine.ts`)

---

## 3. UI/UX 设计与样式实现 (Design Implementation)
下面仅仅是一个参考，对于整体的风格设计你需要严格遵循，在具体的组件上你可以自由发挥

### 3.1 全局布局 (Layout)
Background: bg-[#F9FAFB] (Cool Gray 50)

Header: 高度 64px，bg-white，下边框 border-b border-[#EAECF0]。

Sidebar: 宽度 320px，bg-white，右边框 border-r border-[#EAECF0]。

Main: 剩余空间，用于放置 Canvas。

### 3.2 组件样式规范
卡片 (Card) - 用于控制面板和统计
JavaScript

// 样式类：
// bg-white rounded-xl border border-gray-200 shadow-sm
<div className="bg-white rounded-xl border border-[#EAECF0] shadow-[0_1px_2px_rgba(16,24,40,0.05)] p-4">
  {/* Content */}
</div>
按钮 (Primary Action)
JavaScript

// 样式类：
// bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700
<button className="bg-[#155EEF] hover:bg-[#114AC6] text-white text-sm font-semibold py-2 px-4 rounded-lg shadow-sm transition-colors duration-200">
  开始实验
</button>
文本排版
H1/Title: text-[#101828] font-semibold text-lg

Label: text-[#344054] font-medium text-sm

Meta/Description: text-[#475467] text-xs

### 3.3 画布设计 (The Canvas)
背景色设置为白色 bg-white，带有微弱的网格线。

Agent 样式:

圆圈，半径 6px。

颜色：根据主导兴趣映射（例如：Technology = Blue, Art = Purple）。

边框：2px 白色描边（区分重叠）。

连线样式:

颜色：rgba(21, 94, 239, 0.2) (Brand Blue with low opacity)。

宽度：随好感度变化，0.5px 到 2px。

Canvas 的内部分辨率要按 `devicePixelRatio` 适配，否则会糊 & 点击坐标不准（这会直接影响“点人”的交互准确性）。`getBoundingClientRect` 用于获取元素尺寸与位置。([MDN Web Docs][3])

---

## 4. 实验功能具体算法 (Feature Algorithms)

### 功能 1：两点间路径 (BFS)
当用户点击两个 Agent 后触发：

输入: StartNode, EndNode。

数据源: 使用当前的 agent.connections 邻接表。

算法:

初始化 queue = [[start]]，visited = {start}。

循环直到 queue 空：

弹出路径 path，取最后一个节点 node。

若 node === end，返回 path。

遍历 node 的邻居 neighbor：

若未访问，将 [...path, neighbor] 入队，标记访问。

可视化: 将路径上的边高亮显示（颜色变为 Orange/Red，线宽加粗）。

### 功能 2：地理位置动态查询（更新为“点人查看”）

**输入**：选中 Agent A + 半径 r
**输出**：

* Direct：A 的直接好友里，距离 A ≤ r 的人
* Indirect：Direct 的好友并集（去重，排除 A 与 Direct）

### 功能 3：兴趣匹配 Top N（更新为“点人匹配”）

**输入**：选中 Agent A + N
**逻辑**：遍历所有人 j（排除自己），用同一个 `match(A,j)` 打分排序取前 N
（保证“推荐逻辑”和“交友逻辑”一致）

---

## 5. 搭建指南 (Step-by-Step Implementation Guide)
下面是一个代码参考，你可以参考这里的代码实现

## /src/lib/utils.ts

```ts
// src/lib/utils.ts
import { Vec2 } from '@/types';

export function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export function len(v: Vec2) {
  return Math.hypot(v.x, v.y);
}

export function normalize(v: Vec2): Vec2 {
  const l = len(v);
  if (l < 1e-9) return { x: 0, y: 0 };
  return { x: v.x / l, y: v.y / l };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function mul(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s };
}

export function dist(a: Vec2, b: Vec2) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function clampMagnitude(v: Vec2, maxLen: number): Vec2 {
  const l = len(v);
  if (l <= maxLen) return v;
  const k = maxLen / (l + 1e-9);
  return { x: v.x * k, y: v.y * k };
}

// 二进制向量 cosine（0/1 也能用，结果在 [0,1]）
export function cosine01(a: number[], b: number[]) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na < 1e-9 || nb < 1e-9) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// 指数阻尼：v *= exp(-drag*dt)
export function expDampFactor(drag: number, dt: number) {
  return Math.exp(-drag * dt);
}

export function randRange(lo: number, hi: number) {
  return lo + Math.random() * (hi - lo);
}

export function randUnit(): Vec2 {
  const a = Math.random() * Math.PI * 2;
  return { x: Math.cos(a), y: Math.sin(a) };
}
```

---

## /src/lib/simulationEngine.ts

```ts
// src/lib/simulationEngine.ts
import { Agent, INTEREST_DIM, Vec2 } from '@/types';
import {
  add, clamp, clampMagnitude, cosine01, dist, expDampFactor,
  mul, normalize, randRange, randUnit, sub
} from '@/lib/utils';

type ContactSets = {
  directIds: string[];
  indirectIds: string[];
};

export class SimulationEngine {
  agents: Agent[] = [];
  width: number;
  height: number;

  // ====== 参数（最小必要，可在 ControlPanel 暴露） ======
  params = {
    // 感知/社交
    senseRadius: 150,

    // 好感度
    forgetRate: 0.05,        // λ：越大遗忘越快（向0回归）
    matchRate: 0.35,         // η：匹配推动强度
    crowdRate: 0.60,         // γ：拥挤惩罚强度
    personalSpace: 14,       // 小于此距离会产生“烦”惩罚

    // 连边阈值（互惠 + 滞回）
    connectOn: 0.60,
    connectOff: 0.45,

    // 匹配分权重
    wInterest: 0.55,
    wAge: 0.20,
    wGender: 0.05,
    wMutual: 0.20,
    ageScale: 12,            // 年龄差衰减尺度

    // 运动
    sepRange: 16,            // 排斥作用距离
    sepStrength: 500,        // 排斥加速度强度（线性推开）
    friendAttract: 35,       // 好友吸引加速度
    wanderAccel: 28,         // 随机游走加速度
    drag: 3.0,               // 阻尼
    vMax: 120,               // 限速（px/s）
    restitution: 0.85,       // 边界反弹损耗
  };

  // 内部：无向邻接（Set 更好用）
  private adjacency: Map<string, Set<string>> = new Map();
  // 内部：快速查找
  private id2agent: Map<string, Agent> = new Map();

  constructor(w: number, h: number, agentCount: number) {
    this.width = w;
    this.height = h;
    this.initAgents(agentCount);
    this.rebuildIndex();
    this.rebuildConnections(); // 初始空图也走一遍
  }

  resize(w: number, h: number) {
    this.width = w;
    this.height = h;
  }

  // ====== 对外：每帧传入 dt（秒） ======
  step(dt: number) {
    // dt 保护：避免切后台回来爆炸
    const safeDt = clamp(dt, 0, 0.05);

    this.updateMovements(safeDt);
    this.updateAffinities(safeDt);
    this.rebuildConnections();   // 从 affinity 重建无向图快照
    this.rebuildIndex();         // 更新 id->agent 映射（可省，但保持稳）
  }

  snapshot() {
    return this.agents;
  }

  getAgent(id: string) {
    return this.id2agent.get(id) || null;
  }

  // ====== 实验功能1：最短路径 BFS（基于无向 connections） ======
  findPath(startId: string, endId: string): string[] {
    if (startId === endId) return [startId];
    if (!this.adjacency.has(startId) || !this.adjacency.has(endId)) return [];

    const q: string[] = [startId];
    const prev = new Map<string, string | null>();
    prev.set(startId, null);

    while (q.length) {
      const cur = q.shift()!;
      const nbrs = this.adjacency.get(cur);
      if (!nbrs) continue;

      for (const nb of nbrs) {
        if (prev.has(nb)) continue;
        prev.set(nb, cur);
        if (nb === endId) {
          // 回溯
          const path: string[] = [];
          let x: string | null = endId;
          while (x) {
            path.push(x);
            x = prev.get(x) ?? null;
          }
          path.reverse();
          return path;
        }
        q.push(nb);
      }
    }
    return [];
  }

  // ====== 实验功能2：基于“选中Agent”的 Direct/Indirect ======
  getContactSets(agentId: string, radius: number): ContactSets {
    const a = this.getAgent(agentId);
    if (!a) return { directIds: [], indirectIds: [] };

    const r = radius;
    const direct: string[] = [];
    for (const fid of a.connections) {
      const f = this.getAgent(fid);
      if (!f) continue;
      if (dist(a.position, f.position) <= r) direct.push(fid);
    }

    const directSet = new Set(direct);
    const indirectSet = new Set<string>();

    for (const did of direct) {
      const dAgent = this.getAgent(did);
      if (!dAgent) continue;
      for (const x of dAgent.connections) {
        if (x === agentId) continue;
        if (directSet.has(x)) continue;
        indirectSet.add(x);
      }
    }

    return { directIds: direct, indirectIds: Array.from(indirectSet) };
  }

  // ====== 实验功能3：基于“选中Agent”的 TopN 匹配 ======
  matchTopN(agentId: string, topN: number): { id: string; score: number }[] {
    const a = this.getAgent(agentId);
    if (!a) return [];
    const results: { id: string; score: number }[] = [];

    for (const b of this.agents) {
      if (b.id === agentId) continue;
      const score = this.matchScore(a, b);
      results.push({ id: b.id, score });
    }

    results.sort((x, y) => y.score - x.score);
    return results.slice(0, Math.max(0, topN));
  }

  // ====== 交互：从坐标选中最近Agent ======
  pickAgent(x: number, y: number, pickRadius = 10): string | null {
    let bestId: string | null = null;
    let bestD = Infinity;
    for (const a of this.agents) {
      const d = Math.hypot(a.position.x - x, a.position.y - y);
      if (d < bestD) {
        bestD = d;
        bestId = a.id;
      }
    }
    if (bestD <= pickRadius) return bestId;
    return null;
  }

  // =================== 内部实现 ===================

  private initAgents(n: number) {
    const mkInterests = () => {
      // 每人随机选择 2~4 个兴趣为1（简单但够用）
      const v = Array(INTEREST_DIM).fill(0);
      const k = Math.floor(randRange(2, 5));
      const chosen = new Set<number>();
      while (chosen.size < k) chosen.add(Math.floor(randRange(0, INTEREST_DIM)));
      for (const idx of chosen) v[idx] = 1;
      return v;
    };

    for (let i = 0; i < n; i++) {
      const id = `A-${i}-${Math.floor(Math.random() * 1e9)}`;
      const a: Agent = {
        id,
        name: `User-${1000 + i}`,
        age: Math.floor(randRange(18, 66)),
        gender: Math.random() < 0.5 ? 'Male' : 'Female',
        interests: mkInterests(),
        position: { x: randRange(40, this.width - 40), y: randRange(40, this.height - 40) },
        velocity: { x: randRange(-30, 30), y: randRange(-30, 30) },
        affinity: new Map(),
        connections: [],
        wander: { dir: randUnit(), ttl: randRange(0.5, 1.2) },
      };
      this.agents.push(a);
    }
  }

  private rebuildIndex() {
    this.id2agent.clear();
    for (const a of this.agents) this.id2agent.set(a.id, a);
  }

  // 运动：排斥 + 好友吸引 + wander + 阻尼 + 限速 + 边界
  private updateMovements(dt: number) {
    const p = this.params;

    // 先计算加速度（每个agent累计）
    const acc: Map<string, Vec2> = new Map();
    for (const a of this.agents) acc.set(a.id, { x: 0, y: 0 });

    // (1) 排斥：O(N^2) 够用（你规模通常<=200）
    for (let i = 0; i < this.agents.length; i++) {
      for (let j = i + 1; j < this.agents.length; j++) {
        const ai = this.agents[i];
        const aj = this.agents[j];
        const d = dist(ai.position, aj.position);
        if (d <= 1e-6) continue;

        if (d < p.sepRange) {
          const dir = normalize(sub(ai.position, aj.position)); // j->i
          const overlap = (p.sepRange - d) / p.sepRange;        // 0..1
          const f = p.sepStrength * overlap;                    // 线性推开（软）
          const fi = mul(dir, f);
          const fj = mul(dir, -f);

          acc.set(ai.id, add(acc.get(ai.id)!, fi));
          acc.set(aj.id, add(acc.get(aj.id)!, fj));
        }
      }
    }

    // (2) 好友吸引：只对无向 connections
    for (const a of this.agents) {
      const aAcc = acc.get(a.id)!;
      for (const fid of a.connections) {
        const fAgent = this.id2agent.get(fid);
        if (!fAgent) continue;

        const d = dist(a.position, fAgent.position);
        if (d < 1e-6) continue;
        const dir = normalize(sub(fAgent.position, a.position)); // a->friend
        // 弱吸引：距离越远稍大，但不要爆
        const strength = p.friendAttract * clamp(d / p.senseRadius, 0, 1);
        acc.set(a.id, add(aAcc, mul(dir, strength)));
      }
    }

    // (3) wander：每隔 0.5~1.2s 换方向（平滑噪声）
    for (const a of this.agents) {
      a.wander.ttl -= dt;
      if (a.wander.ttl <= 0) {
        a.wander.dir = randUnit();
        a.wander.ttl = randRange(0.5, 1.2);
      }
      acc.set(a.id, add(acc.get(a.id)!, mul(a.wander.dir, p.wanderAccel)));
    }

    // (4) 积分 + 阻尼 + 限速 + 边界
    const damp = expDampFactor(p.drag, dt);
    for (const a of this.agents) {
      // v += a*dt
      const aAcc = acc.get(a.id)!;
      a.velocity = add(a.velocity, mul(aAcc, dt));

      // 阻尼
      a.velocity = mul(a.velocity, damp);

      // 限速
      a.velocity = clampMagnitude(a.velocity, p.vMax);

      // pos += v*dt
      a.position = add(a.position, mul(a.velocity, dt));

      // 边界反弹（带损耗）
      if (a.position.x < 0) {
        a.position.x = 0;
        a.velocity.x = -a.velocity.x * p.restitution;
      } else if (a.position.x > this.width) {
        a.position.x = this.width;
        a.velocity.x = -a.velocity.x * p.restitution;
      }
      if (a.position.y < 0) {
        a.position.y = 0;
        a.velocity.y = -a.velocity.y * p.restitution;
      } else if (a.position.y > this.height) {
        a.position.y = this.height;
        a.velocity.y = -a.velocity.y * p.restitution;
      }
    }
  }

  // 好感：只在半径内更新（O(N^2)）
  private updateAffinities(dt: number) {
    const p = this.params;

    // mutual 依赖“上一轮 connections”（无向图快照）即可
    const mutualCount = (aId: string, bId: string) => {
      const aSet = this.adjacency.get(aId);
      const bSet = this.adjacency.get(bId);
      if (!aSet || !bSet) return 0;
      let c = 0;
      for (const x of aSet) if (bSet.has(x)) c++;
      return c;
    };

    for (let i = 0; i < this.agents.length; i++) {
      for (let j = 0; j < this.agents.length; j++) {
        if (i === j) continue;

        const ai = this.agents[i];
        const aj = this.agents[j];
        const d = dist(ai.position, aj.position);
        if (d > p.senseRadius) continue;

        // 1) match 0..1
        const m = this.matchScore(ai, aj, mutualCount(ai.id, aj.id));

        // 2) crowd 0..1
        const crowd = d < p.personalSpace
          ? clamp((p.personalSpace - d) / p.personalSpace, 0, 1)
          : 0;

        // 3) signedMatch -1..1
        const signedMatch = (m - 0.5) * 2;

        // 4) 取旧值
        const old = ai.affinity.get(aj.id) ?? 0;

        // 5) 遗忘 + 更新
        const decayed = old * Math.exp(-p.forgetRate * dt);
        const updated = decayed + dt * (p.matchRate * signedMatch - p.crowdRate * crowd);

        ai.affinity.set(aj.id, clamp(updated, -1, 1));
      }
    }
  }

  // matchScore 默认使用 mutual（如未传则内部算0）
  private matchScore(a: Agent, b: Agent, mutualOverride?: number) {
    const p = this.params;

    const interestSim = cosine01(a.interests, b.interests); // 0..1
    const ageSim = Math.exp(-Math.abs(a.age - b.age) / p.ageScale); // 0..1

    // 性别偏好：极简（可在面板调）
    // 默认：轻微偏好异性
    const genderPref = a.gender === b.gender ? 0.48 : 0.52;

    // 共同好友饱和：mutual/(mutual+3)
    const mutual = mutualOverride ?? 0;
    const mutualSim = mutual / (mutual + 3);

    const score =
      p.wInterest * interestSim +
      p.wAge * ageSim +
      p.wGender * genderPref +
      p.wMutual * mutualSim;

    return clamp(score, 0, 1);
  }

  // 从有向 affinity 重建无向 connections + adjacency（互惠 + 滞回）
  private rebuildConnections() {
    const p = this.params;

    // 先确保 adjacency 有所有节点
    const nextAdj = new Map<string, Set<string>>();
    for (const a of this.agents) nextAdj.set(a.id, new Set());

    // 当前 adjacency（上一轮）用于滞回判断
    const curAdj = this.adjacency;

    const getF = (from: Agent, toId: string) => from.affinity.get(toId) ?? 0;

    for (let i = 0; i < this.agents.length; i++) {
      for (let j = i + 1; j < this.agents.length; j++) {
        const ai = this.agents[i];
        const aj = this.agents[j];

        const fij = getF(ai, aj.id);
        const fji = getF(aj, ai.id);

        const wasConnected = curAdj.get(ai.id)?.has(aj.id) ?? false;

        let connected: boolean;
        if (!wasConnected) {
          connected = (fij > p.connectOn && fji > p.connectOn);
        } else {
          connected = !(fij < p.connectOff || fji < p.connectOff);
        }

        if (connected) {
          nextAdj.get(ai.id)!.add(aj.id);
          nextAdj.get(aj.id)!.add(ai.id);
        }
      }
    }

    // 写回 adjacency
    this.adjacency = nextAdj;

    // 写回每个 Agent.connections（数组快照）
    for (const a of this.agents) {
      a.connections = Array.from(this.adjacency.get(a.id) ?? []);
    }
  }
}
```

---

## /src/components/simulation/SocialGraph.tsx（Canvas + dt + 选人交互）

> **必要点**：Canvas 分辨率按 dpr resize，否则会糊且点选不准。`getBoundingClientRect` 用于获取 CSS 尺寸。([MDN Web Docs][3])
> **最小实现**：ResizeObserver 监听容器尺寸变化，然后同步更新 canvas 内部分辨率。

```tsx
// src/components/simulation/SocialGraph.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { SimulationEngine } from '@/lib/simulationEngine';

type Mode = 'none' | 'path';

export default function SocialGraph() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<SimulationEngine | null>(null);

  // UI 状态（最小必要）
  const [running, setRunning] = useState(true);
  const [mode, setMode] = useState<Mode>('none');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Path 模式：选择两点
  const [pathStart, setPathStart] = useState<string | null>(null);
  const [pathEnd, setPathEnd] = useState<string | null>(null);
  const [highlightPath, setHighlightPath] = useState<string[]>([]);

  // 功能2：direct/indirect 高亮
  const [directIds, setDirectIds] = useState<string[]>([]);
  const [indirectIds, setIndirectIds] = useState<string[]>([]);

  // 功能3：topN 匹配高亮
  const [topMatches, setTopMatches] = useState<{ id: string; score: number }[]>([]);
  const [topN, setTopN] = useState(8);
  const [nearRadius, setNearRadius] = useState(150);

  // 帮助集合查询
  const directSet = useMemo(() => new Set(directIds), [directIds]);
  const indirectSet = useMemo(() => new Set(indirectIds), [indirectIds]);
  const matchSet = useMemo(() => new Set(topMatches.map(x => x.id)), [topMatches]);

  // 1) 初始化引擎 + Resize canvas
  useEffect(() => {
    if (!wrapRef.current || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const wrap = wrapRef.current;

    const resizeToWrap = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;

      // canvas 内部分辨率 = CSS尺寸 * dpr
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);

      // CSS 尺寸由 class 控制，这里不设 style.width/height
      const engine = engineRef.current;
      if (engine) engine.resize(canvas.width, canvas.height);
    };

    // 初始化 engine（用 canvas 内部分辨率作为世界尺寸）
    resizeToWrap();
    engineRef.current = new SimulationEngine(canvas.width, canvas.height, 80);

    const ro = new ResizeObserver(() => resizeToWrap());
    ro.observe(wrap);

    return () => ro.disconnect();
  }, []);

  // 2) rAF 主循环：dt-based step + draw
  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let last = performance.now();

    const loop = (now: number) => {
      const engine = engineRef.current;
      if (!engine) return;

      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      if (running) engine.step(dt);

      draw(ctx, canvas, engine.snapshot());

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running, selectedId, highlightPath, directSet, indirectSet, matchSet]);

  // 3) 点击选人：把 client 坐标映射到 canvas 内部坐标（dpr 已包含在 canvas.width/height）
  const onClick = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    const engine = engineRef.current;
    if (!canvas || !engine) return;

    const rect = canvas.getBoundingClientRect();
    // 把 CSS像素坐标映射到 canvas 像素坐标
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;

    const id = engine.pickAgent(x, y, 12);
    if (!id) return;

    // 普通模式：更新 selected
    setSelectedId(id);

    // Path 模式：两次点击定 start/end
    if (mode === 'path') {
      if (!pathStart || (pathStart && pathEnd)) {
        setPathStart(id);
        setPathEnd(null);
        setHighlightPath([]);
      } else if (!pathEnd && id !== pathStart) {
        setPathEnd(id);
        const path = engine.findPath(pathStart, id);
        setHighlightPath(path);
      }
    }
  };

  // 功能2：查看 direct/indirect
  const runNearby = () => {
    const engine = engineRef.current;
    if (!engine || !selectedId) return;
    const sets = engine.getContactSets(selectedId, nearRadius);
    setDirectIds(sets.directIds);
    setIndirectIds(sets.indirectIds);
  };

  // 功能3：匹配 TopN
  const runMatch = () => {
    const engine = engineRef.current;
    if (!engine || !selectedId) return;
    setTopMatches(engine.matchTopN(selectedId, topN));
  };

  // 重置高亮
  const clearHighlights = () => {
    setDirectIds([]);
    setIndirectIds([]);
    setTopMatches([]);
    setHighlightPath([]);
    setPathStart(null);
    setPathEnd(null);
  };

  return (
    <div className="w-full h-full flex">
      {/* Sidebar（最小必要控件） */}
      <div className="w-[320px] bg-white border-r border-[#EAECF0] p-4 space-y-4">
        <div className="text-[#101828] font-semibold text-lg">Nexus</div>

        <div className="bg-white rounded-xl border border-[#EAECF0] shadow-[0_1px_2px_rgba(16,24,40,0.05)] p-4 space-y-3">
          <div className="text-[#344054] font-medium text-sm">运行控制</div>

          <button
            className="w-full bg-[#155EEF] hover:bg-[#114AC6] text-white text-sm font-semibold py-2 px-4 rounded-lg shadow-sm transition-colors duration-200"
            onClick={() => setRunning(v => !v)}
          >
            {running ? '暂停' : '继续'}
          </button>

          <button
            className="w-full bg-white border border-[#EAECF0] hover:bg-[#F9FAFB] text-[#344054] text-sm font-semibold py-2 px-4 rounded-lg shadow-sm transition-colors duration-200"
            onClick={clearHighlights}
          >
            清除高亮
          </button>
        </div>

        <div className="bg-white rounded-xl border border-[#EAECF0] shadow-[0_1px_2px_rgba(16,24,40,0.05)] p-4 space-y-3">
          <div className="text-[#344054] font-medium text-sm">实验功能</div>

          {/* 功能1：路径模式 */}
          <div className="space-y-2">
            <div className="text-[#475467] text-xs">
              路径：打开后点击两个人，显示最短路径（BFS）
            </div>
            <button
              className="w-full bg-white border border-[#EAECF0] hover:bg-[#F9FAFB] text-[#344054] text-sm font-semibold py-2 px-4 rounded-lg shadow-sm transition-colors duration-200"
              onClick={() => {
                setMode(m => (m === 'path' ? 'none' : 'path'));
                setPathStart(null);
                setPathEnd(null);
                setHighlightPath([]);
              }}
            >
              {mode === 'path' ? '退出路径模式' : '进入路径模式'}
            </button>
          </div>

          {/* 功能2：附近联络 */}
          <div className="space-y-2 pt-2 border-t border-[#EAECF0]">
            <div className="text-[#475467] text-xs">
              附近联络：先点选一个人，再点击按钮
            </div>
            <label className="text-[#344054] font-medium text-sm">半径 r = {nearRadius}px</label>
            <input
              type="range"
              min={50}
              max={300}
              value={nearRadius}
              onChange={(e) => setNearRadius(parseInt(e.target.value, 10))}
              className="w-full"
            />
            <button
              className="w-full bg-white border border-[#EAECF0] hover:bg-[#F9FAFB] text-[#344054] text-sm font-semibold py-2 px-4 rounded-lg shadow-sm transition-colors duration-200"
              onClick={runNearby}
              disabled={!selectedId}
            >
              查看 Direct / Indirect
            </button>
          </div>

          {/* 功能3：TopN匹配 */}
          <div className="space-y-2 pt-2 border-t border-[#EAECF0]">
            <div className="text-[#475467] text-xs">
              TopN：先点选一个人，再匹配
            </div>
            <label className="text-[#344054] font-medium text-sm">Top N</label>
            <input
              type="number"
              min={1}
              max={30}
              value={topN}
              onChange={(e) => setTopN(parseInt(e.target.value || '1', 10))}
              className="w-full border border-[#EAECF0] rounded-lg px-3 py-2 text-sm"
            />
            <button
              className="w-full bg-white border border-[#EAECF0] hover:bg-[#F9FAFB] text-[#344054] text-sm font-semibold py-2 px-4 rounded-lg shadow-sm transition-colors duration-200"
              onClick={runMatch}
              disabled={!selectedId}
            >
              匹配 TopN
            </button>
          </div>
        </div>

        {/* 选中信息 */}
        <div className="bg-white rounded-xl border border-[#EAECF0] shadow-[0_1px_2px_rgba(16,24,40,0.05)] p-4">
          <div className="text-[#344054] font-medium text-sm">当前选中</div>
          <div className="text-[#475467] text-xs mt-1">
            {selectedId ? selectedId : '未选中（点击画布上的人）'}
          </div>
          {mode === 'path' && (
            <div className="text-[#475467] text-xs mt-2">
              PathStart: {pathStart ?? '-'}<br />
              PathEnd: {pathEnd ?? '-'}
            </div>
          )}
        </div>
      </div>

      {/* Main Canvas */}
      <div className="flex-1 p-6 bg-[#F9FAFB]">
        <div
          ref={wrapRef}
          className="w-full h-full bg-white rounded-lg border border-[#EAECF0] shadow-sm overflow-hidden relative"
        >
          <canvas
            ref={canvasRef}
            onClick={onClick}
            className="w-full h-full block cursor-crosshair"
          />
        </div>
      </div>
    </div>
  );

  // ========= 绘制函数 =========
  function draw(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    agents: ReturnType<SimulationEngine['snapshot']>
  ) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 背景网格（弱）
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.strokeStyle = '#101828';
    const grid = 40;
    for (let x = 0; x <= canvas.width; x += grid) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y <= canvas.height; y += grid) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
    ctx.restore();

    // 建一个 id->agent Map，避免 find O(N)
    const map = new Map(agents.map(a => [a.id, a]));

    // 连接线
    ctx.save();
    ctx.strokeStyle = 'rgba(21, 94, 239, 0.15)';
    ctx.lineWidth = 1;

    // path 高亮边集合
    const pathEdge = new Set<string>();
    for (let i = 0; i < highlightPath.length - 1; i++) {
      const u = highlightPath[i];
      const v = highlightPath[i + 1];
      pathEdge.add(`${u}->${v}`);
      pathEdge.add(`${v}->${u}`);
    }

    agents.forEach(a => {
      a.connections.forEach(tid => {
        const t = map.get(tid);
        if (!t) return;

        const key = `${a.id}->${tid}`;
        if (pathEdge.has(key)) {
          ctx.strokeStyle = 'rgba(245, 158, 11, 0.9)'; // 橙
          ctx.lineWidth = 3;
        } else {
          ctx.strokeStyle = 'rgba(21, 94, 239, 0.15)';
          ctx.lineWidth = 1;
        }

        ctx.beginPath();
        ctx.moveTo(a.position.x, a.position.y);
        ctx.lineTo(t.position.x, t.position.y);
        ctx.stroke();
      });
    });
    ctx.restore();

    // 节点
    agents.forEach(a => {
      const isSelected = selectedId === a.id;
      const isDirect = directSet.has(a.id);
      const isIndirect = indirectSet.has(a.id);
      const isMatch = matchSet.has(a.id);

      let r = 5;
      if (isSelected) r = 8;
      else if (isMatch) r = 7;

      // 简单配色：默认深灰；Direct绿；Indirect浅绿；Match蓝
      let fill = '#101828';
      if (isDirect) fill = '#16A34A';
      else if (isIndirect) fill = '#86EFAC';
      else if (isMatch) fill = '#155EEF';

      ctx.beginPath();
      ctx.fillStyle = fill;
      ctx.arc(a.position.x, a.position.y, r, 0, Math.PI * 2);
      ctx.fill();

      // 白色描边
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.stroke();
    });
  }
}
```

--

1. **按 dt 更新**：`engine.step(dt)`，不再按帧写死
2. **好感有向**：`affinity: Map<id, [-1,1]>`
3. **边无向互惠**：`connections` 是引擎重建快照（互惠阈值 + 滞回）
4. **好感能变差**：加入唯一负反馈 “拥挤惩罚 crowd”
5. **兴趣维度 12**：仍然二进制向量，简单但有效
6. **匹配分包含**：兴趣 + 年龄 + 性别 + 共同好友（共同好友不再独立闭包规则）
7. **运动稳定**：软排斥 + 阻尼 + 限速 + 平滑 wander
8. **实验功能2/3 交互修正**：必须先点选一个人再查看/匹配
9. **Canvas dpr 适配**：保证渲染清晰、点击准确（这对“点人交互”是必要项）([MDN Web Docs][3])

