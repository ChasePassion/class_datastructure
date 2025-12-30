// src/components/simulation/SocialGraph.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { SimulationEngine } from '@/lib/simulationEngine';
import { Agent } from '@/types';

type Mode = 'none' | 'path';

// 兴趣标签对应的颜色
const INTEREST_COLORS = [
  '#3B82F6', // Technology - Blue
  '#A855F7', // Art - Purple
  '#22C55E', // Sports - Green
  '#EF4444', // Politics - Red
  '#F59E0B', // Finance - Amber
  '#EC4899', // Music - Pink
  '#06B6D4', // Movies - Cyan
  '#6366F1', // Gaming - Indigo
  '#14B8A6', // Fitness - Teal
  '#F97316', // Travel - Orange
  '#84CC16', // Food - Lime
  '#8B5CF6', // Reading - Violet
];

// 获取 Agent 的主导兴趣颜色
function getAgentColor(interests: number[]): string {
  // 找到第一个为1的兴趣索引
  for (let i = 0; i < interests.length; i++) {
    if (interests[i] === 1) {
      return INTEREST_COLORS[i];
    }
  }
  return '#101828'; // 默认深灰
}

export default function SocialGraph() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<SimulationEngine | null>(null);

  // UI 状态（最小必要）
  const [running, setRunning] = useState(true);
  const [mode, setMode] = useState<Mode>('none');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);

  // 计时器状态
  const [elapsedTime, setElapsedTime] = useState(0); // 已经过的时间（毫秒）
  const startTimeRef = useRef<number | null>(null); // 开始时间戳
  const pausedTimeRef = useRef(0); // 暂停时已累积的时间

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

  // 统计信息
  const [stats, setStats] = useState({ nodeCount: 0, edgeCount: 0, componentCount: 0 });

  // 可调节参数
  const [agentCount, setAgentCount] = useState(80);
  const [senseRadius, setSenseRadius] = useState(150);
  const [matchRate, setMatchRate] = useState(2.5);
  const [connectOn, setConnectOn] = useState(0.20);
  const [friendAttract, setFriendAttract] = useState(35);
  const [vMax, setVMax] = useState(120);

  // 帮助集合查询
  const directSet = useMemo(() => new Set(directIds), [directIds]);
  const indirectSet = useMemo(() => new Set(indirectIds), [indirectIds]);
  const matchSet = useMemo(() => new Set(topMatches.map(x => x.id)), [topMatches]);
  const pathSet = useMemo(() => new Set(highlightPath), [highlightPath]);

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

      // 更新选中的 Agent 信息
      if (selectedId) {
        const agent = engine.getAgent(selectedId);
        setSelectedAgent(agent);
      }

      // 更新统计信息
      setStats(engine.getStats());

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
    setSelectedAgent(engine.getAgent(id));

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

  // 重置模拟
  const resetSimulation = () => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.reset(agentCount);
    clearHighlights();
    setSelectedId(null);
    setSelectedAgent(null);
    setMode('none');
    
    // 重置计时器
    setElapsedTime(0);
    startTimeRef.current = Date.now();
    pausedTimeRef.current = 0;
  };

  // 计时器效果
  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;
    
    if (running) {
      // 如果正在运行，开始或继续计时
      if (startTimeRef.current === null) {
        startTimeRef.current = Date.now();
      } else {
        // 从暂停状态恢复，调整开始时间
        startTimeRef.current = Date.now() - pausedTimeRef.current;
        pausedTimeRef.current = 0;
      }
      
      intervalId = setInterval(() => {
        if (startTimeRef.current !== null) {
          setElapsedTime(Date.now() - startTimeRef.current);
        }
      }, 100); // 每100ms更新一次
    } else {
      // 如果暂停，记录已累积的时间
      if (startTimeRef.current !== null) {
        pausedTimeRef.current = Date.now() - startTimeRef.current;
        startTimeRef.current = null;
      }
    }
    
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [running]);

  // 格式化时间显示
  const formatTime = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  // 更新引擎参数
  const updateEngineParams = () => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.updateParams({
      senseRadius,
      matchRate,
      connectOn,
      connectOff: connectOn * 0.5, // 自动计算断边阈值
      friendAttract,
      vMax,
    });
  };

  // 参数变化时更新引擎
  useEffect(() => {
    updateEngineParams();
  }, [senseRadius, matchRate, connectOn, friendAttract, vMax]);

  // 绘制函数
  function draw(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    agents: Agent[]
  ) {
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 背景网格（弱）
    ctx.save();
    ctx.globalAlpha = 0.04;
    ctx.strokeStyle = '#101828';
    ctx.lineWidth = 1;
    const grid = 50 * dpr;
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

    // 绘制选中节点的感知半径（虚线圆）
    if (selectedId) {
      const selectedAgent = map.get(selectedId);
      if (selectedAgent) {
        ctx.save();
        ctx.setLineDash([8 * dpr, 6 * dpr]); // 虚线样式
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.4)'; // 橙色半透明
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath();
        ctx.arc(
          selectedAgent.position.x,
          selectedAgent.position.y,
          senseRadius * dpr, // 使用当前感知半径
          0,
          Math.PI * 2
        );
        ctx.stroke();
        ctx.restore();
      }
    }

    // path 高亮边集合
    const pathEdge = new Set<string>();
    for (let i = 0; i < highlightPath.length - 1; i++) {
      const u = highlightPath[i];
      const v = highlightPath[i + 1];
      pathEdge.add(`${u}->${v}`);
      pathEdge.add(`${v}->${u}`);
    }

    // 连接线
    ctx.save();
    agents.forEach(a => {
      a.connections.forEach(tid => {
        const t = map.get(tid);
        if (!t) return;

        // 避免重复绘制（只绘制 id 较小的一方）
        if (a.id > tid) return;

        const key1 = `${a.id}->${tid}`;
        const key2 = `${tid}->${a.id}`;

        if (pathEdge.has(key1) || pathEdge.has(key2)) {
          ctx.strokeStyle = 'rgba(245, 158, 11, 0.9)'; // 橙色高亮
          ctx.lineWidth = 3 * dpr;
        } else {
          ctx.strokeStyle = 'rgba(21, 94, 239, 0.18)';
          ctx.lineWidth = 1 * dpr;
        }

        ctx.beginPath();
        ctx.moveTo(a.position.x, a.position.y);
        ctx.lineTo(t.position.x, t.position.y);
        ctx.stroke();
      });
    });
    ctx.restore();

    // 节点（增大尺寸）
    agents.forEach(a => {
      const isSelected = selectedId === a.id;
      const isDirect = directSet.has(a.id);
      const isIndirect = indirectSet.has(a.id);
      const isMatch = matchSet.has(a.id);
      const isOnPath = pathSet.has(a.id);

      let r = 8 * dpr;  // 默认半径从6增大到8
      if (isSelected) r = 12 * dpr;  // 选中从10增大到12
      else if (isMatch || isDirect) r = 10 * dpr;  // 高亮从8增大到10
      else if (isOnPath) r = 10 * dpr;

      // 确定填充色
      let fill = getAgentColor(a.interests);
      if (isSelected) fill = '#F59E0B'; // 选中为橙色
      else if (isDirect) fill = '#16A34A'; // 直接好友绿色
      else if (isIndirect) fill = '#86EFAC'; // 间接好友浅绿
      else if (isMatch) fill = '#155EEF'; // 匹配蓝色
      else if (isOnPath) fill = '#F59E0B'; // 路径上橙色

      // 绘制阴影（选中状态）
      if (isSelected) {
        ctx.save();
        ctx.shadowColor = 'rgba(245, 158, 11, 0.5)';
        ctx.shadowBlur = 15 * dpr;
        ctx.beginPath();
        ctx.fillStyle = fill;
        ctx.arc(a.position.x, a.position.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      ctx.beginPath();
      ctx.fillStyle = fill;
      ctx.arc(a.position.x, a.position.y, r, 0, Math.PI * 2);
      ctx.fill();

      // 白色描边
      ctx.lineWidth = 2 * dpr;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.stroke();
    });
  }

  return (
    <div className="w-full h-full flex">
      {/* Sidebar */}
      <div className="w-[320px] bg-white border-r border-[#EAECF0] flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-[#EAECF0]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#155EEF] to-[#7C3AED] flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <div className="text-[#101828] font-semibold text-lg tracking-tight">Nexus</div>
              <div className="text-[#475467] text-xs">社交网络涌现模拟器</div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* 统计卡片 */}
          <div className="bg-gradient-to-br from-[#F9FAFB] to-white rounded-xl border border-[#EAECF0] p-4">
            <div className="text-[#344054] font-medium text-sm mb-3">实时统计</div>
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center">
                <div className="text-2xl font-bold text-[#155EEF]">{stats.nodeCount}</div>
                <div className="text-xs text-[#475467]">节点</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-[#16A34A]">{stats.edgeCount}</div>
                <div className="text-xs text-[#475467]">连边</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-[#7C3AED]">{stats.componentCount}</div>
                <div className="text-xs text-[#475467]">分量</div>
              </div>
            </div>
          </div>

          {/* 运行控制 */}
          <div className="bg-white rounded-xl border border-[#EAECF0] shadow-[0_1px_2px_rgba(16,24,40,0.05)] p-4 space-y-3">
            <div className="text-[#344054] font-medium text-sm">运行控制</div>
            
            {/* 时间显示 */}
            <div className="bg-gradient-to-br from-[#F0F9FF] to-[#E0F2FE] rounded-lg border border-[#BAE6FD] p-3">
              <div className="text-[#0EA5E9] text-xs mb-1">⏱ 运行时长</div>
              <div className="flex items-baseline gap-2">
                <div className="text-3xl font-bold text-[#0284C7] font-mono">
                  {formatTime(elapsedTime)}
                </div>
                <div className="text-xs text-[#475467]">
                  {running ? '🟢 运行中' : '🟡 已暂停'}
                </div>
              </div>
            </div>
            
            <div className="flex gap-2">
              <button
                className={`flex-1 text-sm font-semibold py-2.5 px-4 rounded-lg shadow-sm transition-all duration-200 ${
                  running
                    ? 'bg-[#155EEF] hover:bg-[#114AC6] text-white'
                    : 'bg-[#16A34A] hover:bg-[#15803D] text-white'
                }`}
                onClick={() => setRunning(v => !v)}
              >
                {running ? '⏸ 暂停' : '▶ 继续'}
              </button>
              <button
                className="flex-1 bg-white border border-[#EAECF0] hover:bg-[#F9FAFB] text-[#344054] text-sm font-semibold py-2.5 px-4 rounded-lg shadow-sm transition-colors duration-200"
                onClick={clearHighlights}
              >
                清除高亮
              </button>
            </div>
            <button
              className="w-full bg-gradient-to-r from-[#EF4444] to-[#F97316] hover:from-[#DC2626] hover:to-[#EA580C] text-white text-sm font-semibold py-2.5 px-4 rounded-lg shadow-sm transition-all duration-200"
              onClick={resetSimulation}
            >
              🔄 重置模拟
            </button>
          </div>

          {/* 参数调节 */}
          <div className="bg-white rounded-xl border border-[#EAECF0] shadow-[0_1px_2px_rgba(16,24,40,0.05)] p-4 space-y-3">
            <div className="text-[#344054] font-medium text-sm">参数调节</div>
            
            {/* 节点数量 */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-[#475467]">节点数量</span>
                <span className="text-[#344054] font-mono">{agentCount}</span>
              </div>
              <input
                type="range"
                min={20}
                max={200}
                step={10}
                value={agentCount}
                onChange={(e) => setAgentCount(parseInt(e.target.value, 10))}
                className="w-full h-1.5 bg-[#EAECF0] rounded-lg appearance-none cursor-pointer"
              />
              <div className="text-[10px] text-[#98A2B3]">重置后生效</div>
            </div>

            {/* 感知半径 */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-[#475467]">感知半径</span>
                <span className="text-[#344054] font-mono">{senseRadius}px</span>
              </div>
              <input
                type="range"
                min={50}
                max={300}
                value={senseRadius}
                onChange={(e) => setSenseRadius(parseInt(e.target.value, 10))}
                className="w-full h-1.5 bg-[#EAECF0] rounded-lg appearance-none cursor-pointer"
              />
            </div>

            {/* 匹配强度 */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-[#475467]">匹配强度</span>
                <span className="text-[#344054] font-mono">{matchRate.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min={0.5}
                max={5}
                step={0.1}
                value={matchRate}
                onChange={(e) => setMatchRate(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-[#EAECF0] rounded-lg appearance-none cursor-pointer"
              />
            </div>

            {/* 连边阈值 */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-[#475467]">连边阈值</span>
                <span className="text-[#344054] font-mono">{connectOn.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0.1}
                max={0.8}
                step={0.05}
                value={connectOn}
                onChange={(e) => setConnectOn(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-[#EAECF0] rounded-lg appearance-none cursor-pointer"
              />
            </div>

            {/* 好友吸引力 */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-[#475467]">好友吸引力</span>
                <span className="text-[#344054] font-mono">{friendAttract}</span>
              </div>
              <input
                type="range"
                min={10}
                max={100}
                value={friendAttract}
                onChange={(e) => setFriendAttract(parseInt(e.target.value, 10))}
                className="w-full h-1.5 bg-[#EAECF0] rounded-lg appearance-none cursor-pointer"
              />
            </div>

            {/* 最大速度 */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-[#475467]">最大速度</span>
                <span className="text-[#344054] font-mono">{vMax}px/s</span>
              </div>
              <input
                type="range"
                min={30}
                max={200}
                value={vMax}
                onChange={(e) => setVMax(parseInt(e.target.value, 10))}
                className="w-full h-1.5 bg-[#EAECF0] rounded-lg appearance-none cursor-pointer"
              />
            </div>
          </div>

          {/* 实验功能 */}
          <div className="bg-white rounded-xl border border-[#EAECF0] shadow-[0_1px_2px_rgba(16,24,40,0.05)] p-4 space-y-4">
            <div className="text-[#344054] font-medium text-sm">实验功能</div>

            {/* 功能1：路径模式 */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-[#F59E0B]"></div>
                <span className="text-[#344054] text-sm font-medium">最短路径 (BFS)</span>
              </div>
              <div className="text-[#475467] text-xs pl-3.5">
                点击两个节点，计算并高亮显示最短路径
              </div>
              <button
                className={`w-full text-sm font-semibold py-2.5 px-4 rounded-lg shadow-sm transition-all duration-200 ${
                  mode === 'path'
                    ? 'bg-[#F59E0B] hover:bg-[#D97706] text-white'
                    : 'bg-white border border-[#EAECF0] hover:bg-[#F9FAFB] text-[#344054]'
                }`}
                onClick={() => {
                  setMode(m => (m === 'path' ? 'none' : 'path'));
                  setPathStart(null);
                  setPathEnd(null);
                  setHighlightPath([]);
                }}
              >
                {mode === 'path' ? '✓ 路径模式已开启' : '进入路径模式'}
              </button>
              {mode === 'path' && (
                <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-lg p-2.5 text-xs text-[#92400E]">
                  <div>起点: {pathStart ? '已选择' : '点击选择'}</div>
                  <div>终点: {pathEnd ? '已选择' : pathStart ? '点击选择' : '-'}</div>
                  {highlightPath.length > 0 && (
                    <div className="mt-1 text-[#16A34A]">路径长度: {highlightPath.length - 1} 步</div>
                  )}
                </div>
              )}
            </div>

            {/* 功能2：附近联络 */}
            <div className="space-y-2 pt-3 border-t border-[#EAECF0]">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-[#16A34A]"></div>
                <span className="text-[#344054] text-sm font-medium">地理位置查询</span>
              </div>
              <div className="text-[#475467] text-xs pl-3.5">
                查看选中节点在指定半径内的直接和间接好友
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[#344054] text-xs whitespace-nowrap">半径</span>
                <input
                  type="range"
                  min={50}
                  max={300}
                  value={nearRadius}
                  onChange={(e) => setNearRadius(parseInt(e.target.value, 10))}
                  className="flex-1 h-1.5 bg-[#EAECF0] rounded-lg appearance-none cursor-pointer accent-[#16A34A]"
                />
                <span className="text-[#344054] text-xs font-mono w-12 text-right">{nearRadius}px</span>
              </div>
              <button
                className="w-full bg-white border border-[#EAECF0] hover:bg-[#F9FAFB] text-[#344054] text-sm font-semibold py-2.5 px-4 rounded-lg shadow-sm transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={runNearby}
                disabled={!selectedId}
              >
                查看附近联络
              </button>
              {(directIds.length > 0 || indirectIds.length > 0) && (
                <div className="bg-[#F0FDF4] border border-[#BBF7D0] rounded-lg p-2.5 text-xs">
                  <div className="text-[#16A34A]">直接好友: {directIds.length} 人</div>
                  <div className="text-[#4ADE80]">间接好友: {indirectIds.length} 人</div>
                </div>
              )}
            </div>

            {/* 功能3：TopN匹配 */}
            <div className="space-y-2 pt-3 border-t border-[#EAECF0]">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-[#155EEF]"></div>
                <span className="text-[#344054] text-sm font-medium">兴趣匹配 Top N</span>
              </div>
              <div className="text-[#475467] text-xs pl-3.5">
                为选中节点推荐匹配度最高的 N 个好友
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[#344054] text-xs whitespace-nowrap">数量</span>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={topN}
                  onChange={(e) => setTopN(parseInt(e.target.value || '1', 10))}
                  className="flex-1 border border-[#EAECF0] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#155EEF] focus:border-transparent"
                />
              </div>
              <button
                className="w-full bg-white border border-[#EAECF0] hover:bg-[#F9FAFB] text-[#344054] text-sm font-semibold py-2.5 px-4 rounded-lg shadow-sm transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={runMatch}
                disabled={!selectedId}
              >
                匹配推荐
              </button>
              {topMatches.length > 0 && (
                <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg p-2.5 text-xs text-[#1D4ED8]">
                  找到 {topMatches.length} 个匹配
                </div>
              )}
            </div>
          </div>

          {/* 选中信息 */}
          {selectedAgent && (
            <div className="bg-white rounded-xl border border-[#EAECF0] shadow-[0_1px_2px_rgba(16,24,40,0.05)] p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[#344054] font-medium text-sm">选中节点详情</div>
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: getAgentColor(selectedAgent.interests) }}
                ></div>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-[#475467]">名称</span>
                  <span className="text-[#101828] font-medium">{selectedAgent.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#475467]">年龄</span>
                  <span className="text-[#101828] font-medium">{selectedAgent.age} 岁</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#475467]">性别</span>
                  <span className="text-[#101828] font-medium">{selectedAgent.gender === 'Male' ? '男' : '女'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#475467]">好友数</span>
                  <span className="text-[#101828] font-medium">{selectedAgent.connections.length}</span>
                </div>
                <div className="pt-2 border-t border-[#EAECF0]">
                  <span className="text-[#475467]">兴趣</span>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {['技术', '艺术', '运动', '政治', '金融', '音乐', '电影', '游戏', '健身', '旅行', '美食', '阅读'].map((tag, i) => (
                      selectedAgent.interests[i] === 1 && (
                        <span
                          key={i}
                          className="px-2 py-0.5 rounded-full text-xs text-white"
                          style={{ backgroundColor: INTEREST_COLORS[i] }}
                        >
                          {tag}
                        </span>
                      )
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main Canvas */}
      <div className="flex-1 p-5 bg-[#F9FAFB]">
        <div
          ref={wrapRef}
          className="w-full h-full bg-white rounded-xl border border-[#EAECF0] shadow-sm overflow-hidden relative"
        >
          <canvas
            ref={canvasRef}
            onClick={onClick}
            className="w-full h-full block cursor-crosshair"
          />
          {/* 图例 */}
          <div className="absolute bottom-4 right-4 bg-white/90 backdrop-blur-sm rounded-lg border border-[#EAECF0] p-3 text-xs">
            <div className="text-[#344054] font-medium mb-2">图例</div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-[#F59E0B]"></div>
                <span className="text-[#475467]">选中 / 路径</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-[#16A34A]"></div>
                <span className="text-[#475467]">直接好友</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-[#86EFAC]"></div>
                <span className="text-[#475467]">间接好友</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-[#155EEF]"></div>
                <span className="text-[#475467]">匹配推荐</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
