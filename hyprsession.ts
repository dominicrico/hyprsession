import { HyprBun, Window } from "./hyprbun"
import { checkFlatpakList, findMatchingWindow, getProcessByPidOrName, isPossibleAppImage, spawnIndipendent, waitTillWindowIsReady } from "./utils"
import { homedir } from "os"
import { join } from "path"
import { mkdir, stat, writeFile } from "fs/promises"
import { chalkStderr } from 'chalk'
import ora, { Ora } from 'ora'
import { readFile } from "fs/promises"
import meow from 'meow'

export type Session = Partial<Window> & { cmd: string, appImage?: string, flatpak?: string, ppid?: number }

enum Direction {
    R = 'r',
    L = 'l',
    U = 'u',
    D = 'd',
}

const cli = meow(`
	Usage
	  $ hyprsession

	Options
	  --restore-session, -r  Restores the last session
   --save-session, -s     Saves the current session
   --auto-save, -a        Periodicaly save running session [default=true]
   --interval, -i         Time between auto saves in seconds [default=60]
   --silent, -x           Don't print anything to stdout
   --debug, -v            Print debug logs
   --help                 Shows this help text

	Examples
	  $ hyprsession --save-session
	  ✔ Saved current session

   To Store a session once from cli
   $ hprsession --save-session --auto-save=false
`, {
    description: 'Save the current hyprland clients and restore them on hyprland start.\nBy default tries to restore a session first, if there is none is starts saving it periodicaly.',
	importMeta: import.meta,
	flags: {
		restoreSession: {
			type: 'boolean',
			shortFlag: 'r',
            default: false
		},
        saveSession: {
			type: 'boolean',
			shortFlag: 's',
            default: false
		},
        autoSave: {
			type: 'boolean',
			shortFlag: 'a',
            default: true
		},
        interval: {
			type: 'number',
			shortFlag: 'i',
            default: 60
		},
        silent: {
			type: 'boolean',
			shortFlag: 'x',
            default: false
		},
        debug: {
			type: 'boolean',
			shortFlag: 'v',
            default: false
		}
	}
})

class HyprSession {
    public spinner: Ora
    private controller: AbortController = new AbortController()
    private signal: AbortSignal = this.controller.signal
    public static HYPRSESSION_DIR: string = join(homedir(), '.local', 'share', 'hyprsession')
    private hyprBun: HyprBun = new HyprBun()
    private currentSession: Session[] = []
    private flags: typeof cli.flags
    private groups: {[key: string]: string[]} = {}

    constructor(flags: typeof cli.flags) {
        this.flags = flags

        if (this.flags.saveSession) {
            this.storeSession() 
        } else {
            this.restoreSession()
        }
    }

    public static async ensureDirectory() {
        try {
            await stat(this.HYPRSESSION_DIR)
        } catch(e) {
            await mkdir(this.HYPRSESSION_DIR, { recursive: true })
        }
    }

    public log(msg: string, type?: string) {
        if (!this.spinner || this.flags.silent)
            return

        if (type) {
            this.spinner[type](msg)
        } else {
            this.spinner.text = msg
        }

        if (this.flags.debug) console.log(msg)

        return 
    }

    private checkGroup(group: string[], address: string): boolean {
        const groupIdentifier = group.join(':')
        if (this.groups[groupIdentifier]) {
            this.groups[groupIdentifier].push(address)
            return true
        }

        this.groups[groupIdentifier] = [address]
        return false
    }

    private async guessSideOfGroup(win: Window, group: string[]): Promise<Direction> {
        const clients = await this.hyprBun.clients()

        const firstGroupMember = this.groups[group.join(':')][0]
        const groupBaseWindow = clients.find(client => client.address === firstGroupMember)
        const currWindow = clients.find(client => client.address === win.address)

        if (groupBaseWindow!.at[0] >= currWindow!.at[0])
            return Direction.R

        return Direction.L
    }

    private async setWindowProperties(client: Session, win: Window): Promise<void> {
        try {
            if (win.floating && client.size)
                await this.hyprBun.dispatch('resizewindowpixel', client.size[0], client.size[1], `address:${win.address}`)
            
            if (win.floating && client.at)
                await this.hyprBun.dispatch('movewindowpixel', client.at[0], client.at[1], `address:${win.address}`)
            
            if (win.floating && !client.floating)
                await this.hyprBun.dispatch('settiled', `address:${win.address}`)
            
            if (win.workspace?.name !== client.workspace?.name)
                await this.hyprBun.dispatch('movetoworkspace', `${client.workspace?.name.replace(/^special:/,'')},address:${win.address}`)
    
            if (!win.grouped?.length && client.grouped?.length)
                !this.checkGroup(client.grouped, win.address) ? await this.hyprBun.dispatch('togglegroup') : await this.hyprBun.dispatch('moveintogroup', await this.guessSideOfGroup(win, client.grouped))

            if (client.grouped?.length && this.groups[client.grouped.join(':')].length === client.grouped.length && client.workspace?.name.includes('special:'))
                await this.hyprBun.dispatch('togglespecialworkspace', client.workspace?.name.replace(/^special:/,''))
            
            this.log(`Restored ${client.initialClass}`)
        } catch(e) {
            this.log(e.message, 'fail')
        }

        return
    }

    public async storeSession(once = false): Promise<void|Timer> {
        if (!this.flags.silent) {
            const spinnerText = `Saving current session...`

            if (!this.spinner) {
                this.spinner = ora({text: spinnerText, color: 'white'})
                this.spinner.start()
            } else {
                this.log(spinnerText)
            }
        }
    
        try {
            const clients = await this.hyprBun.clients()
    
            this.currentSession = await Promise.all(clients.map(async client => ({
                ...client,
                flatpak: (await checkFlatpakList(client)),
                appImage: (await isPossibleAppImage(client.class)),
                cmd: (await getProcessByPidOrName(client.pid))[0].cmd
            })))
        } catch(err: any) {
            this.log(`${chalkStderr.red('ERROR:')} ${err.message}`, 'fail')
            process.exit(1)
        }
    
        try {
            await writeFile(join(HyprSession.HYPRSESSION_DIR, 'session.json'), JSON.stringify(this.currentSession), { signal: this.signal })
            
            if (once !== false || !this.flags.autoSave) {
                this.log(`Saved current session`, 'succeed')
                process.exit(0)
            }
        } catch(err: any) {
            this.log(`${chalkStderr.red('ERROR:')} ${err.message}`, 'fail')
            process.exit(1)
        }

        this.log(`Saved current session. Waiting...`)
        return setTimeout(() => this.storeSession(), this.flags.interval * 1000)
    }

    private async restoreSession() {
        let session: Session[]
        const spinnerText = `Restoring last session...`

        if (!this.flags.silent) {
            if (!this.spinner) {
                this.spinner = ora({text: spinnerText, color: 'white'})
                this.spinner.start()
            } else {
                this.log(spinnerText)
            }
        }
    
        try {
            session = JSON.parse(await readFile(join(HyprSession.HYPRSESSION_DIR, 'session.json'), { encoding: 'utf-8', signal: this.signal})).sort((a: Window, b: Window) => b.grouped.length - a.grouped.length)
        } catch(e) {
            this.log('No session found.')
            return this.storeSession()
        }
    
        for (const client of session) {
            try {
                this.log(`Restoring ${client.initialClass}...`)
    
                const windowExists = await findMatchingWindow(client)

                if (!!windowExists) {
                    this.log(`Found window for ${windowExists.initialClass}`)
                    await this.setWindowProperties(client, windowExists)
                    continue
                }
                
                this.log(`Starting application ${client.initialClass}...`)
                const pids: {pid?: number, ppid?: number} = spawnIndipendent(client.appImage || client.flatpak || client.cmd)
                
                client.pid = pids.pid
                client.ppid = pids.ppid
    
                this.log(`Waiting for ${client.initialClass} to start...`)
                await new Promise(resolve => setTimeout(resolve, 300))
                const win = await waitTillWindowIsReady(client)
    
                this.log(`Restoring properties for ${client.initialClass}...`)
        
                await this.setWindowProperties(client, win)
                continue
            } catch(e) {
                console.log(e.message)
                break
            }
        }
        
        this.log('Session restored!')

        if (this.flags.restoreSession)
            return process.exit(0)

        return this.storeSession()
    }
}

(async () => {
    await HyprSession.ensureDirectory()
    
    const hyprSession = new HyprSession(cli.flags)
    
    process.on('SIGINT', async () => {
        //await hyprSession.storeSession(true)
        return process.exit(0)
    })
})() 
