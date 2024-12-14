import { createConnection, Socket } from 'net'

export const enum Icons {
  none = -1,
  warning = 0,
  info = 1,
  hint = 2,
  error = 3,
  confused = 4,
  ok = 5,
}

type Address = string

export interface Window {
  address: Address,
  mapped: boolean,
  hidden: boolean,
  at: [ number, number ],
  size: [ number, number ],
  workspace: { id: number, name: string },
  floating: boolean,
  monitor: number,
  class: string,
  title: string,
  initialClass: string,
  initialTitle: string,
  pid: number,
  xwayland: boolean,
  pinned: boolean,
  fullscreen: boolean,
  fullscreenMode: number,
  fakeFullscreen: boolean,
  grouped: Address[],
  swallowing: string,
  focusHistoryID: number
}

export type Device = {
  address: Address
  name: string
}

export type Mouse = Device & { defaultSpeed: number }
export type Keyboard = Device & {
  rules: string
  model: string
  layout: string
  variant: string
  options: string
  active_keymap: string
  main: boolean
}

export interface LayerOutputInterface {
  levels: Record<string, {
      address: Address
      x: number
      y: number
      w: number
      h: number
      namespace: string
  }[]>
}

export interface Monitor {
  id: number
  name: string
  description: string
  make: string
  model: string
  serial: string
  width: number
  height: number
  refreshRate: number
  x: number
  y: number
  activeWorkspace: { id: number, name: string }
  specialWorkspace: { id: number, name: string }
  reserved: [number, number, number, number]
  scale: number
  transform: number
  focused: boolean
  dpmsStatus: boolean
  vrr: boolean
  activelyTearing: boolean
  disabled: boolean
  currentFormat: string
  availableModes: string[]
}

export interface Event {
  name: string
  data: string
}

export interface Workspace {
  id: number
  name: string
  monitor: string
  monitorID: number
  windows: number
  hasfullscreen: boolean
  lastwindow: Address
  lastwindowtitle: string
}

export interface Bind {
  locked: boolean,
  mouse: boolean,
  release: boolean,
  repeat: boolean,
  non_consuming: boolean,
  modmask: number,
  submap: string,
  key: string,
  keycode: number,
  catch_all: boolean,
  dispatcher: string,
  arg: string,
}

type DispatcherDirection = 'u' | 'd' | 'l' | 'r'

/** These args are probably wrong */
export interface DispatchersArgs {
  'exec': [string]
  'killactive': []
  'closewindow': []
  'workspace': [string]
  'movetoworkspace': [string]
  'movetoworkspacesilent': [string]
  'togglefloating': [] | ['active']
  'setfloating': [] | ['active']
  'settiled': [string] | ['active']
  'fullscreen': [] | [0 | 1 | 2]
  'fakefullscreen': []
  'dpms': ['on' | 'off' | 'toggle'] | ['on' | 'off' | 'toggle', string]
  'pin': [] | [string]
  'movefocus': [DispatcherDirection]
  'movewindow': [DispatcherDirection | `mon:${string}` | `mon:${string} silent`]
  'swap': [DispatcherDirection]
  'centerwindow': [] | [1]
  'cyclenext': [] | ['prev' | 'tiled' | 'floating' | 'prev tiled' | 'prev floating']
  'focuswindow': [string]
  'focusmonitor': [string]
  'splitratio': [number]
  'toggleopaque': []
  'movecursortocorner': [0 | 1 | 2 | 3]
  'movecursor': [number, number]
  'resizeactive': [number, number]
  'resizewindowpixel': [number, number, string]
  'movewindowpixel': [number, number, string]
  'moveactive': [number, number]
  'renameworkspace': [string, string]
  'exit': []
  'forcerendererreload': []
  'movecurrentworkspacetomonitor': [string]
  'focusworkspaceoncurrentmonitor': [string]
  'moveworkspacetomonitor': [string, string]
  'swapactiveworkspaces': [string, string]
  'togglespecialworkspace': [] | [string]
  'focusurgentorlast': [] | [string]
  'togglegroup': [] | [string]
  'changegroupactive': [] | [string]
  'focuscurrentorlast': [] | [string]
  'lockgroups': ['lock' | 'unlock' | 'toggle']
  'lockactivegroup': ['lock' | 'unlock' | 'toggle']
  'moveintogroup': ['u' | 'd' | 'l' | 'r']
  'moveoutofgroup': [] | ['active' | string]
  'movewindoworgroup': ['u' | 'd' | 'l' | 'r']
  'movegroupwindow': ['b' | string]
  'denywindowfromgroup': ['on' | 'off' | 'toggle']
  'setignoregrouplock': ['on' | 'off' | 'toggle']
  'global': [string]
  'summap': ['reset' | string]
  'setprop': [string]
}

export class HyprBun {
  socket: Socket & { connected?: boolean } = new Socket()
  instanceSignature: string
  chunks: Uint8Array[] = []

  constructor(instanceSignature = Bun.env['HYPRLAND_INSTANCE_SIGNATURE'] || '') {
    this.instanceSignature = instanceSignature
  }

  async clients() {
    return this.hyprctlJson<Window[]>('j/clients')
  }

  async activewindow() {
    return this.hyprctlJson<Window>('j/activewindow')
  }

  async activeworkspace() {
    return this.hyprctlJson<Workspace>('j/activeworkspace')
  }

  async binds() {
    return this.hyprctlJson<Bind[]>('j/binds')
  }

  async decorations(query: string) {
    return this.hyprctl(`decorations ${query}`)
  }

  async cursorpos() {
    return this.hyprctlJson('j/cursorpos')
  }

  async devices() {
    return this.hyprctlJson<{
        mice: Mouse[]
        keyboards: Keyboard[]
        tables: Device[]
        touch: Device[]
        switches: Device[]
    }>('j/devices')
  }

  /** Dismisses all or up to `count` notifications */
  async dismissnotify(count?: number) {
      return this.hyprctl(`dismissnotify ${count ?? ''}`)
  }

  /** Lists all running instances of Hyprland with their info */
  async instances() {
      return this.hyprctlJson<{
          instance: string,
          time: number,
          pid: number,
          wl_socket: string
      }[]>('j/instances')
  }

  /** Lists all the surface layers */
  async layers() {
      return this.hyprctlJson<
          Record<string, LayerOutputInterface>
      >('j/layers')
  }

  /** lists all layouts available (including plugin'd ones) */
  async layouts() {
      return this.hyprctlJson<string[]>('j/layouts')
  }

  /** Lists active outputs with their properties, 'monitors all' lists active and inactive outputs */
  async monitors() {
      return this.hyprctlJson<Monitor[]>('j/monitors')

  }  

  /** Run multiple hyprctl commands in a batch */
  async batch(commands: string[]) {
    console.log(`--batch ${commands.join(';')}`)
      if (!commands?.length)
        return
      return this.hyprctl(`--batch ${commands.join(';')}`)
  }

  /** Sends a notification using the built-in Hyprland notification system */
  async notify({
      icon = Icons.none,
      duration = 3000,
      color = 0x55aabbff,
      message = ''
  }: {
      icon?: Icons
      duration?: number
      color?: number
      message: string
  }) {
      return this.hyprctl(`notify ${icon} ${duration} rgba(${color.toString(16).padStart(8, '0')}) ${message}`)
  }

  async version() {
      return this.hyprctlJson<{
          branch: string
          commit: string
          dirty: boolean
          commit_message: string
          commit_date: string
          tag: string
          commits: number
          flags: unknown[]
      }>('j/version')
  }

  async workspaces() {
      return this.hyprctlJson<Workspace[]>('j/workspaces')
  }

  async dispatch<Dispatcher extends keyof DispatchersArgs>(
      dispatcher: Dispatcher,
      ...commands: DispatchersArgs[Dispatcher]
  ) {
      return this.hyprctl(`dispatch ${dispatcher} ${commands.join(' ')}`)
  }

  private async open(): Promise<void> {
    return new Promise((resolve) => {
      if (this.socket.connected) return resolve()

      const runtimeDir = Bun.env['XDG_RUNTIME_DIR'] || '/tmp'
      const path = `${runtimeDir}/hypr/${this.instanceSignature}/.socket.sock`

      this.socket.once('connect', () => {
        this.socket.connected = true
        resolve()
      })

      this.socket.connect(path)
    })
  }

  private close() {
    if (this.socket) {
      this.socket.end()
      this.socket.connected = false
    }
  }

  async hyprctl(cmd: string): Promise<string> {
    return new Promise(async (resolve) => {
      const chunks: Uint8Array[] = []

      await this.open()

      this.socket?.write(cmd)

      const timeout = setTimeout(() => {
        endSocket()
        this.socket.off('end', onEnd)
      }, 1000)

      const onData = (chunk: Uint8Array) => {
        chunks.push(chunk)
      }

      const onEnd = () => {
        clearTimeout(timeout)
        endSocket()
      }
      
      const endSocket = () => {
        this.close()
        const msg = Buffer.concat(chunks).toString()
        this.socket?.off('data', onData)
        resolve(msg)
      }
      
      this.socket?.once('end', onEnd)
      this.socket?.on('data', onData)
    })
  }

  async hyprctlJson<T>(cmd: string): Promise<T> {
    const response = await this.hyprctl(cmd)
    return JSON.parse(response)
  }

  async *events() {
    const runtimeDir = Bun.env['XDG_RUNTIME_DIR'] || '/tmp'
    const path = `${runtimeDir}/hypr/${this.instanceSignature}/.socket2.sock`
    const eventSocket = createConnection(path)

    const decoder = new TextDecoder()
    for await (const chunk of eventSocket) {
      const lines = decoder.decode(chunk).split('\n')
      for (const line of lines) {
        const [name, data] = line.split('>>')
        yield { name, data }
      }
    }
  }
}