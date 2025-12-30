// src/lib/simulationEngine.ts
import { Agent, INTEREST_DIM, Vec2 } from "@/types";
import {
  add,
  clamp,
  clampMagnitude,
  cosine01,
  dist,
  expDampFactor,
  mul,
  normalize,
  randRange,
  randUnit,
  sub,
} from "@/lib/utils";

type ContactSets = {
  directIds: string[];
  indirectIds: string[];
  stepMap: Map<string, number>; // 节点ID -> 步数
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
    forgetRate: 0.05, // λ：越大遗忘越快（向0回归）
    matchRate: 2, // η：匹配推动强度
    crowdRate: 0.6, // γ：拥挤惩罚强度
    personalSpace: 20, // 小于此距离会产生"烦"惩罚

    // 连边阈值（互惠 + 滞回）
    connectOn: 0.3,
    connectOff: 0.1,

    // 匹配分权重
    wInterest: 0.55,
    wAge: 0.2,
    wGender: 0.05,
    wMutual: 0.2,
    ageScale: 12, // 年龄差衰减尺度

    // 运动
    sepRange: 25, // 排斥作用距离
    sepStrength: 500, // 排斥加速度强度（线性推开）
    friendAttract: 30, // 好友吸引加速度
    wanderAccel: 35, // 随机游走加速度
    drag: 3.0, // 阻尼
    vMax: 120, // 限速（px/s）
    restitution: 0.85, // 边界反弹损耗
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

  // ====== 重置模拟 ======
  reset(agentCount: number) {
    this.agents = [];
    this.adjacency.clear();
    this.id2agent.clear();
    this.initAgents(agentCount);
    this.rebuildIndex();
    this.rebuildConnections();
  }

  // ====== 更新参数 ======
  updateParams(newParams: Partial<typeof this.params>) {
    Object.assign(this.params, newParams);
  }

  // ====== 对外：每帧传入 dt（秒） ======
  step(dt: number) {
    // dt 保护：避免切后台回来爆炸
    const safeDt = clamp(dt, 0, 0.05);

    this.updateMovements(safeDt);
    this.updateAffinities(safeDt);
    this.rebuildConnections(); // 从 affinity 重建无向图快照
    this.rebuildIndex(); // 更新 id->agent 映射（可省，但保持稳）
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

  // ====== 实验功能2：基于"选中Agent"的 Direct/Indirect ======
  getContactSets(agentId: string, radius: number): ContactSets {
    const a = this.getAgent(agentId);
    if (!a) return { directIds: [], indirectIds: [], stepMap: new Map() };

    const r = radius;
    const stepMap = new Map<string, number>();

    // BFS 计算步数
    const visited = new Set<string>();
    const queue: { id: string; step: number }[] = [{ id: agentId, step: 0 }];
    visited.add(agentId);

    const direct: string[] = [];
    const indirect: string[] = [];

    while (queue.length > 0) {
      const { id: currentId, step } = queue.shift()!;

      if (step > 0) {
        const agent = this.getAgent(currentId);
        if (agent && dist(a.position, agent.position) <= r) {
          if (step === 1) {
            direct.push(currentId);
          } else {
            indirect.push(currentId);
          }
          stepMap.set(currentId, step);
        }
      }

      // 只搜索到第3步
      if (step < 3) {
        const currentAgent = this.getAgent(currentId);
        if (!currentAgent) continue;

        for (const neighborId of currentAgent.connections) {
          if (!visited.has(neighborId)) {
            visited.add(neighborId);
            queue.push({ id: neighborId, step: step + 1 });
          }
        }
      }
    }

    return { directIds: direct, indirectIds: indirect, stepMap };
  }

  // ====== 实验功能3：基于"选中Agent"的 TopN 匹配 ======
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
      while (chosen.size < k)
        chosen.add(Math.floor(randRange(0, INTEREST_DIM)));
      for (const idx of chosen) v[idx] = 1;
      return v;
    };

    for (let i = 0; i < n; i++) {
      const id = `A-${i}-${Math.floor(Math.random() * 1e9)}`;
      const a: Agent = {
        id,
        name: `User-${1000 + i}`,
        age: Math.floor(randRange(18, 66)),
        gender: Math.random() < 0.5 ? "Male" : "Female",
        interests: mkInterests(),
        position: {
          x: randRange(40, this.width - 40),
          y: randRange(40, this.height - 40),
        },
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
          const overlap = (p.sepRange - d) / p.sepRange; // 0..1
          const f = p.sepStrength * overlap; // 线性推开（软）
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

    // mutual 依赖"上一轮 connections"（无向图快照）即可
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
        const crowd =
          d < p.personalSpace
            ? clamp((p.personalSpace - d) / p.personalSpace, 0, 2)
            : 0;

        // 3) signedMatch: 让正向匹配更容易（基准点从0.5降到0.3）
        const signedMatch = (m - 0.5) * 2;

        // 4) 取旧值
        const old = ai.affinity.get(aj.id) ?? 0;

        // 5) 遗忘 + 更新
        const decayed = old * Math.exp(-p.forgetRate * dt);
        const updated =
          decayed + dt * (p.matchRate * signedMatch - p.crowdRate * crowd);

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
          connected = fij > p.connectOn && fji > p.connectOn;
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

  // ====== 统计信息 ======
  getStats() {
    let edgeCount = 0;
    for (const a of this.agents) {
      edgeCount += a.connections.length;
    }
    edgeCount = Math.floor(edgeCount / 2); // 无向边计数

    // 连通分量数（并查集简化版）
    const visited = new Set<string>();
    let componentCount = 0;

    const bfs = (startId: string) => {
      const queue = [startId];
      visited.add(startId);
      while (queue.length > 0) {
        const cur = queue.shift()!;
        const neighbors = this.adjacency.get(cur);
        if (!neighbors) continue;
        for (const nb of neighbors) {
          if (!visited.has(nb)) {
            visited.add(nb);
            queue.push(nb);
          }
        }
      }
    };

    for (const a of this.agents) {
      if (!visited.has(a.id)) {
        bfs(a.id);
        componentCount++;
      }
    }

    return {
      nodeCount: this.agents.length,
      edgeCount,
      componentCount,
    };
  }
}
