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
