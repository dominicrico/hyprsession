import { HyprBun, type Window } from "./hyprbun"
import { checkFlatpakList, findMatchingWindow, getProcessByPidOrName, isPossibleAppImage } from "./utils"
import { homedir } from "os"
import { join } from "path"
import { mkdir, stat, writeFile } from "fs/promises"
import { chalkStderr } from 'chalk'
import ora, { type Ora } from 'ora'
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

/**
 * Represents a Hyprland session, providing methods for saving and restoring the state of Hyprland clients.
 */
class HyprSession {
    /**
     * The spinner instance used for displaying progress messages.
     * @type {Ora}
     */
    public spinner?: Ora
    
    /**
     * The AbortController instance used for cancelling ongoing operations.
     * @type {AbortController}
     */
    private controller: AbortController = new AbortController()
    
    /**
     * The AbortSignal instance used for cancelling ongoing operations.
     * @type {AbortSignal}
     */
    private signal: AbortSignal = this.controller.signal
    
    /**
     * The directory path where HyprSession files are stored.
     * @type {string}
     */
    public static HYPRSESSION_DIR: string = join(homedir(), '.local', 'share', 'hyprsession')
    
    /**
     * The HyprBun instance used for interacting with Hyprland.
     * @type {HyprBun}
     */
    private hyprBun: HyprBun = new HyprBun()
    
    /**
     * The current session data, represented as an array of Session objects.
     * @type {Session[]}
     */
    private currentSession: Session[] = []
    
    /**
     * The flags object used for configuring the HyprSession instance.
     * @type {typeof cli.flags}
     */
    private flags: typeof cli.flags

    /**
     * An object mapping group identifiers to arrays of window addresses.
     * @type {{[key: string]: string[]}}
     */
    private groups: {[key: string]: string[]} = {}


    /**
     * Constructs a new HyprSession instance.
     * 
     * This constructor either stores the current session or restores the last saved session.
     * @constructor
     * @param flags The flags passed from the cli.
     */
    constructor(flags: typeof cli.flags) {
        this.flags = flags

        if (this.flags.saveSession) {
            this.storeSession() 
        } else {
            this.restoreSession()
        }
    }


    /**
     * Checks if the directory `HYPRSESSION_DIR` exists. If it does not, it is created.
     * This is a static method, so it can be called without initializing the class.
     * @async
     */
    public static async ensureDirectory() {
        try {
            await stat(this.HYPRSESSION_DIR)
        } catch(e) {
            await mkdir(this.HYPRSESSION_DIR, { recursive: true })
        }
    }

    /**
     * Logs a message to the console. If `type` is provided, it will attempt to call
     * the method on the spinner object with the given `msg`. If no `type` is
     * provided, it will simply set the text of the spinner to the given `msg`.
     * 
     * If `silent` flag is set, this method will not do anything.
     * 
     * If `debug` flag is set, the message will also be logged to the console.
     * @param {string} msg The message to be logged
     * @param {string} [type] The type of message to be logged. If not provided, the message
     * will be logged as a simple text.
     */
    public log(msg: string, type?: string) {
        if (!this.spinner || this.flags.silent)
            return

        if (type) {
            // @ts-ignore
            this.spinner[type](msg)
        } else {
            this.spinner.text = msg
        }

        if (this.flags.debug) console.log(msg)

        return 
    }

    /**
     * Checks if a given address belongs to a specified group.
     *
     * If the group already exists, the address is added to it and returns true.
     * If the group does not exist, it initializes the group with the given address and returns false.
     *
     * @param {string[]} group - An array of strings representing the group.
     * @param {string} address - The address to check and potentially add to the group.
     * @returns {boolean} A boolean indicating if the address was added to an existing group.
     */
    private checkGroup(group: string[], address: string): boolean {
        const groupIdentifier = group.join(':')
        if (this.groups[groupIdentifier]) {
            this.groups[groupIdentifier].push(address)
            return true
        }

        this.groups[groupIdentifier] = [address]
        return false
    }

    /**
     * Guesses the side of a group the given window belongs to.
     * 
     * It does this by taking the first group member as the base window and
     * then comparing the x-coordinate of the given window with the one of the
     * base window. If the x-coordinate of the given window is on the right side
     * of the base window, the function returns Direction.R, otherwise it returns
     * Direction.L.
     * 
     * @async
     * @param {Window} win The window to guess the group side for.
     * @param {string[]} group The group to guess the side for.
     * @returns {Direction} The guessed side of the group.
     */
    private async guessSideOfGroup(win: Window, group: string[]): Promise<Direction> {
        const clients = await this.hyprBun.clients()

        const firstGroupMember = this.groups[group.join(':')][0]
        const groupBaseWindow = clients.find(client => client.address === firstGroupMember)
        const currWindow = clients.find(client => client.address === win.address)

        if (groupBaseWindow!.at[0] >= currWindow!.at[0])
            return Direction.R

        return Direction.L
    }

    /**
     * Set window properties for a given client.
     * 
     * This function applies the rules set in the client object to the window with the given address.
     * 
     * @async
     * @param {Session} client The client object with the rules to apply.
     * @param {Window} win The window object to apply the rules to.
     * @returns {Promise<void>} A promise that resolves when the function is done.
     */
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
        } catch(e: any) {
            this.log(e.message, 'fail')
        }

        return
    }

    /**
     * Apply rules to the application.
     * 
     * The rules are in the following format:
     * [float|tile; [size <width> <height>;] [move <x> <y>;] [group [new|set];] [workspace <name> [silent];] [appImage|flatpak|cmd]]
     * 
     * @async
     * @param {Session} client The application to apply the rules to.
     * @returns {Promise<void>}
     */
    private async applyRules(client: Session): Promise<void> {
        let rules = `[${client.floating ? 'float' : 'tile'};`
        
        if (client.floating && client.size)
            rules += ` size ${client.size.join(' ')};`
        
        if (client.floating && client.at)
            rules += ` move ${client.at.join(' ')};`

        if (client.grouped?.length) {
            if (!this.checkGroup(client.grouped, client.cmd)) {
                rules += ` group new;`
            } else {
                rules += ` group set;`
            }
        } else {
            rules += ` group deny;`
        }
    
        rules += ` workspace ${client.workspace?.name} silent; ]`

        rules += ` ${client.appImage || client.flatpak || client.cmd}`

        await this.hyprBun.dispatch('exec', rules)

        return
    }

    /**
     * Saves the current session by capturing the state of all Hyprland clients
     * and writing it to a session file. If the `once` parameter is set to false
     * and auto-save is enabled, it will continue to save the session at specified
     * intervals.
     * 
     * @async
     * @param {boolean} once - A boolean that when set to true, saves the session only once
     *               and exits; otherwise, it saves periodically based on the interval.
     * 
     * @returns {Promise<void|Timer>} A Timer object if the session is saved periodically; otherwise, void.
     * 
     * If the `silent` flag is not set, a spinner displays the saving status. In case
     * of an error during the saving process, an error message is logged, and the
     * process exits.
     */
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

    /**
     * Restores the last session by reading the session file, sorting the window by their group length in descending order,
     * and applying the rules to the windows. If a window already exists, it will be restored to its original position, size and state.
     * If a window does not exist, it will be started.
     * 
     * @async
     * @returns void
     * 
     * If the `silent` flag is not set, a spinner displays the restoring status. In case
     * of an error during the restoring process, an error message is logged, and the
     * process exits.
     */
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

                await this.applyRules(client)
    
                this.log(`Restored ${client.initialClass}`)
                continue
            } catch(e: any) {
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
        await hyprSession.storeSession(true)
        return process.exit(0)
    })
})() 
