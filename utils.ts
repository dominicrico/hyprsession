import { $ } from 'bun'
import path, { join } from 'path'
import { HyprBun, type Window } from './hyprbun'
import type { Session } from './hyprsession'
import { readdir } from 'node:fs/promises'

const hyprBun = new HyprBun()

function fetchBin(cmd: string) {
  const pieces = cmd.split(path.sep)
  const last = pieces[pieces.length - 1]
  if (last) {
    pieces[pieces.length - 1] = last.split(' ')[0]
  }

  const fixed: string[] = []

  for (const part of pieces) {
    const optIdx = part.indexOf(' -')

    if (optIdx >= 0) {
      // case: /aaa/bbb/ccc -c
      fixed.push(part.substring(0, optIdx).trim())
      break
    } else if (part.endsWith(' ')) {
      // case: node /aaa/bbb/ccc.js
      fixed.push(part.trim())
      break
    }

    fixed.push(part)
  }

  return fixed.join(path.sep)
}

const fetchName = (fullpath: string) => path.basename(fullpath)

const stripLine = (text: string, num: number): string => {
  let idx = 0

  while (num-- > 0) {
    const nIdx = text.indexOf('\n', idx)
    if (nIdx >= 0) {
      idx = nIdx + 1
    }
  }

  return idx > 0 ? text.substring(idx) : text
}

const split = (line: string, max: number) => {
  const cols = line.trim().split(/\s+/)

  if (cols.length > max) {
    cols[max - 1] = cols.slice(max - 1).join(' ')
  }

  return cols
}

const extractColumns = (text: string, idxes: number[], max: number) => {
  const lines = text.split(/(\r\n|\n|\r)/)
  const columns: string[][] = []

  if (!max) {
    max = Math.max.apply(null, idxes) + 1
  }

  lines.forEach(line => {
    const cols = split(line, max)
    const column: string[] = []

    idxes.forEach(idx => {
      column.push(cols[idx] || '')
    })

    columns.push(column)
  })

  return columns
}

const matchName = (text: string, name: string) => {
  if (!name) { 
    return true
  }

  if (text && text.match) {
    return text.match(name)
  }

  return false
}

export interface Proc {
  pid: number,
  ppid: number,
  uid: number,
  gid: number,
  name: string,
  bin: string,
  cmd: string
}

const findFilesByNamePart = async (folderPath: string, namePart: string, recursive = false) => {
  const results: string[] = [];

  const searchDirectory = async (directory: string) => {
      const entries = await readdir(directory, { withFileTypes: true })

      const tasks = entries.map(async (entry) => {
          const fullPath = path.join(directory, entry.name)
          if (entry.isDirectory() && recursive) {
              await searchDirectory(fullPath)
          } else if (entry.isFile() && entry.name.includes(namePart)) {
              results.push(fullPath)
          }
      });

      await Promise.all(tasks)
  }

  await searchDirectory(folderPath)

  return results
}


export const isPossibleAppImage = async (application: string): Promise<string|undefined> => {
  const applicationDirs = [
    join(Bun.env['HOME'] as string, '.local/share/applications/'),
    '/use/share/applications'
  ]

  const found = await findFilesByNamePart(applicationDirs[0], application)

  if (found?.length) {
    const file = Bun.file(found[0])
    const desktopFile = await file.text()
    const matches = desktopFile.match(/StartupWMClass=(\w+)/gmi)?.at(0)
    const isAppImage = matches?.includes(application)
    
    if (isAppImage) {
      const exec = desktopFile.match(/Exec=(.+)/gmi)?.at(0)?.replace(/Exec=/, '')
      return exec
    }
  }

  return
}

export const checkFlatpakList = async (client: Window): Promise<string> => {
  return new Promise(async (resolve, reject) => {
    try  {
      const out = await $`flatpak list --columns=name,application --user --system`.text()

      const data = stripLine(out.toString(), 1)
      const columns = extractColumns(data, [0, 1], 2).filter(column => {
        return !!column[0]
      })

      const found = columns.filter(col => client.initialTitle.toLocaleLowerCase().includes(col[0].toLowerCase())).flatMap((col) => col[1])[0]

      return resolve(found)
    } catch(e: any) {
      console.log(e)
      return reject(e)
    }
  })
}

export const getProcessByPidOrName = async (proc?: number | string, strict?: boolean ): Promise<Proc[]> => {
  return new Promise(async (resolve, reject) => {
    let cmd: string = 'ps ax -ww -o pid,ppid,uid,gid,args'
    
    if (proc) {
      cmd = `ps -p ${proc} -ww -o pid,ppid,uid,gid,args`
    }

    try  {
      const out = await $`sh -c "${cmd}"`.text()

      const data = stripLine(out.toString(), 1)
        const columns = extractColumns(data, [0, 1, 2, 3, 4], 5).filter(column => {
          if (column[0] && proc) {
            return column[0] === String(proc)
          } else if (column[4] && typeof(proc) === 'string') {
            return matchName(column[4], proc)
          } else {
            return !!column[0]
          }
        })

        let list = columns.map(column => {
          const cmd = String(column[4])
          const bin = fetchBin(cmd)

          return {
            pid: parseInt(column[0], 10),
            ppid: parseInt(column[1], 10),
            uid: parseInt(column[2], 10),
            gid: parseInt(column[3], 10),
            name: fetchName(bin),
            bin: bin,
            cmd: column[4]
          }
        })

        if (strict && typeof(proc) === 'string') {
          list = list.filter(item => item.name === proc)
        }

        return resolve(list)
    } catch(e: any) {
      if (proc) {
        // when pid not exists, call `ps -p ...` will cause error, we have to
        // ignore the error and resolve with empty array
        return resolve([])
      } else {
        return reject(e)
      }
    }
  })
}

export const findMatchingWindow = async (client: Session): Promise<Window|undefined> => {
  try {
    const currentClients = await hyprBun.clients()
    return Promise.resolve(currentClients.find(cClient => cClient.initialTitle === client.initialTitle) || currentClients.find(cClient => cClient.initialClass === client.initialClass) || currentClients.find(cClient => cClient.class === client.class) || currentClients.find(cClient => cClient.class?.includes(client?.class!)) || currentClients.find(cClient => cClient.pid === client.pid))
  } catch(e) {
    console.log(e)
    return Promise.reject(e)
  }
}