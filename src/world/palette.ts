// Colour and shape table (CITY_MAP.md, colour meaning). Every visual state
// has a colour role and a shape or glyph difference, so no state relies on
// colour alone. Both themes keep every distinction.

export type Theme = 'light' | 'dark';

/** Colour roles. State roles carry meaning; the rest is scenery. */
export type Role =
  // Tasks
  | 'task.user' | 'task.kernel' | 'task.runnable' | 'task.sleeping'
  // CPU token and handler context
  | 'cpu.user' | 'cpu.kernel' | 'cpu.hardirq' | 'cpu.softirq' | 'cpu.idle'
  // Pages
  | 'page.absent' | 'page.locked' | 'page.uptodate'
  // Cargo
  | 'cargo.inflight' | 'cargo.done' | 'cargo.work'
  // Scenery
  | 'ground' | 'zone.userland' | 'zone.gate' | 'zone.kernel' | 'zone.hardware'
  | 'district' | 'district.border' | 'lot' | 'lot.border' | 'home' | 'road' | 'wall'
  | 'pad' | 'lane' | 'core' | 'ink' | 'outline' | 'glyph' | 'text' | 'text.muted' | 'highlight' | 'pulse';

export const PALETTE: Readonly<Record<Theme, Readonly<Record<Role, string>>>> = {
  light: {
    'task.user': '#2563c9',
    'task.kernel': '#c2570c',
    'task.runnable': '#8a6d00',
    'task.sleeping': '#6b7480',
    'cpu.user': '#2563c9',
    'cpu.kernel': '#c2570c',
    'cpu.hardirq': '#c8102e',
    'cpu.softirq': '#7e3fb0',
    'cpu.idle': '#6b7480',
    'page.absent': '#7c8591',
    'page.locked': '#b3261e',
    'page.uptodate': '#16803c',
    'cargo.inflight': '#0b7f8f',
    'cargo.done': '#16803c',
    'cargo.work': '#0b7f8f',
    ground: '#f3f0e8',
    'zone.userland': '#e4ecf8',
    'zone.gate': '#d9d2c3',
    'zone.kernel': '#efe9dd',
    'zone.hardware': '#e2e6ea',
    district: '#fbfaf7',
    'district.border': '#8f97a1',
    lot: '#efe9dd',
    'lot.border': '#b2aa9a',
    home: '#f8fafd',
    road: '#d3cab9',
    wall: '#5e5342',
    pad: '#c9c0ae',
    lane: '#e9e4d8',
    core: '#cfd5db',
    ink: '#1b2128',
    outline: '#1b2128',
    glyph: '#ffffff',
    text: '#1b2128',
    'text.muted': '#5b6470',
    highlight: '#d6006f',
    pulse: '#1b2128',
  },
  dark: {
    'task.user': '#5c9dff',
    'task.kernel': '#ff9640',
    'task.runnable': '#e8c547',
    'task.sleeping': '#8e99a7',
    'cpu.user': '#5c9dff',
    'cpu.kernel': '#ff9640',
    'cpu.hardirq': '#ff5468',
    'cpu.softirq': '#c58aff',
    'cpu.idle': '#8e99a7',
    'page.absent': '#7f8996',
    'page.locked': '#ff6f61',
    'page.uptodate': '#3fcf78',
    'cargo.inflight': '#33d1e0',
    'cargo.done': '#3fcf78',
    'cargo.work': '#33d1e0',
    ground: '#111418',
    'zone.userland': '#16202d',
    'zone.gate': '#2a2720',
    'zone.kernel': '#1a1916',
    'zone.hardware': '#161b20',
    district: '#22262c',
    'district.border': '#5a626d',
    lot: '#1a1916',
    'lot.border': '#474d55',
    home: '#1f2a38',
    road: '#353a42',
    wall: '#c4b089',
    pad: '#3b4048',
    lane: '#2a2e35',
    core: '#2e353d',
    ink: '#eef1f4',
    outline: '#0a0c0f',
    glyph: '#0a0c0f',
    text: '#e8ebef',
    'text.muted': '#9aa3ae',
    highlight: '#ff4fa8',
    pulse: '#eef1f4',
  },
};

export type Shape = 'circle' | 'diamond' | 'hexagon' | 'square' | 'triangle';
/** A small mark drawn on or around the body. */
export type Glyph = 'none' | 'ring' | 'bar' | 'pause' | 'dot' | 'tri' | 'box' | 'cross';

export interface Look {
  role: Role;
  shape: Shape;
  /** Outline only, no fill. */
  hollow: boolean;
  glyph: Glyph;
  /** Legend text, matching a row of the CITY_MAP colour table. */
  meaning: string;
}

export type LookId =
  | 'task.user' | 'task.kernel'
  | 'task.user.runnable' | 'task.kernel.runnable'
  | 'task.user.sleeping' | 'task.kernel.sleeping'
  | 'task.user.interrupted' | 'task.kernel.interrupted'
  | 'cpu.user' | 'cpu.kernel' | 'cpu.hardirq' | 'cpu.softirq' | 'cpu.idle'
  | 'page.absent' | 'page.locked' | 'page.uptodate'
  | 'request.queued' | 'request.issued' | 'request.in_device' | 'request.device_done'
  | 'flow';

// Shape rules:
//   task body: circle in user mode, diamond in kernel mode (the shape changes
//   at the gate, rule 1). Run state is a glyph: ring = runnable, bar = asleep,
//   pause = running but its CPU was taken by an interrupt.
//   CPU token: hexagon. Glyph by context; idle is hollow.
//   page: square. Absent hollow, locked with a cross, up to date with a dot.
//   request cargo: triangle, glyph by stage. flow (the work of one syscall):
//   triangle with a ring.
export const LOOKS: Readonly<Record<LookId, Look>> = {
  'task.user': { role: 'task.user', shape: 'circle', hollow: false, glyph: 'none', meaning: 'Task, user mode, on a CPU' },
  'task.kernel': { role: 'task.kernel', shape: 'diamond', hollow: false, glyph: 'none', meaning: 'Task, kernel mode (process context), on a CPU' },
  'task.user.runnable': { role: 'task.runnable', shape: 'circle', hollow: false, glyph: 'ring', meaning: 'Task runnable, waiting for a CPU (user mode)' },
  'task.kernel.runnable': { role: 'task.runnable', shape: 'diamond', hollow: false, glyph: 'ring', meaning: 'Task runnable, waiting for a CPU (kernel mode)' },
  'task.user.sleeping': { role: 'task.sleeping', shape: 'circle', hollow: false, glyph: 'bar', meaning: 'Task sleeping (user mode)' },
  'task.kernel.sleeping': { role: 'task.sleeping', shape: 'diamond', hollow: false, glyph: 'bar', meaning: 'Task sleeping (kernel mode)' },
  'task.user.interrupted': { role: 'task.user', shape: 'circle', hollow: false, glyph: 'pause', meaning: 'Task stopped: an interrupt borrowed its CPU (user mode)' },
  'task.kernel.interrupted': { role: 'task.kernel', shape: 'diamond', hollow: false, glyph: 'pause', meaning: 'Task stopped: an interrupt borrowed its CPU (kernel mode)' },
  'cpu.user': { role: 'cpu.user', shape: 'hexagon', hollow: false, glyph: 'none', meaning: 'CPU running user code' },
  'cpu.kernel': { role: 'cpu.kernel', shape: 'hexagon', hollow: false, glyph: 'dot', meaning: 'CPU running kernel code for a task' },
  'cpu.hardirq': { role: 'cpu.hardirq', shape: 'hexagon', hollow: false, glyph: 'tri', meaning: 'CPU in hardirq context' },
  'cpu.softirq': { role: 'cpu.softirq', shape: 'hexagon', hollow: false, glyph: 'box', meaning: 'CPU in softirq context' },
  'cpu.idle': { role: 'cpu.idle', shape: 'hexagon', hollow: true, glyph: 'none', meaning: 'CPU idle' },
  'page.absent': { role: 'page.absent', shape: 'square', hollow: true, glyph: 'none', meaning: 'Page absent from the cache' },
  'page.locked': { role: 'page.locked', shape: 'square', hollow: false, glyph: 'cross', meaning: 'Page locked for I/O' },
  'page.uptodate': { role: 'page.uptodate', shape: 'square', hollow: false, glyph: 'dot', meaning: 'Page up to date' },
  'request.queued': { role: 'cargo.inflight', shape: 'triangle', hollow: false, glyph: 'none', meaning: 'Block request queued' },
  'request.issued': { role: 'cargo.inflight', shape: 'triangle', hollow: false, glyph: 'dot', meaning: 'Block request issued to the driver' },
  'request.in_device': { role: 'cargo.inflight', shape: 'triangle', hollow: false, glyph: 'bar', meaning: 'I/O in flight in the device' },
  'request.device_done': { role: 'cargo.done', shape: 'triangle', hollow: false, glyph: 'cross', meaning: 'Device finished, completion pending' },
  flow: { role: 'cargo.work', shape: 'triangle', hollow: true, glyph: 'ring', meaning: "A syscall's work (moves without the task while it sleeps)" },
};

/** Colour of a role in a theme, as 0xRRGGBB. */
export function colour(theme: Theme, role: Role): number {
  return Number.parseInt(PALETTE[theme][role].slice(1), 16);
}

/** WCAG relative luminance of '#rrggbb'. */
export function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
