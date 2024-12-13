# HyprSession

HyprSession is a utility designed to store and restore window sessions for Hyprland, a dynamic tiling window manager for Linux. Initially created using [Bun.js](https://bun.sh), the tool is compiled into a binary for seamless usage on Linux systems.

## Features

- **Save and Restore Sessions**: Quickly save your current window layout and restore it later.
- **Automatic Session Saving**: Periodically save running sessions with customizable intervals.
- **Silent Mode**: Run commands without printing output to stdout for a clutter-free experience.

## Installation

1. Download the precompiled binary from the [releases](#) section.
2. Move the binary to a directory in your `PATH` (e.g., `/usr/local/bin`).
3. Make it executable:

   ```bash
   chmod +x /usr/local/bin/hyprsession
   ```
4. Add it to your hyprland.conf
   ```bash
   exec-once = hyprsession
   # or 
   exec-once = hyprsession --silent
   ```

## Usage

```bash
$ hyprsession
```

### Options

| Option                 | Alias | Description                                 | Default       |
|------------------------|-------|---------------------------------------------|---------------|
| `--restore-session`    | `-r`  | Restores the last session                   |               |
| `--save-session`       | `-s`  | Saves the current session                   |               |
| `--auto-save`          | `-a`  | Periodically save running sessions          | `true`        |
| `--interval`           | `-i`  | Time between auto saves (in seconds)        | `60`          |
| `--silent`             | `-x`  | Suppress all output to stdout               |               |
| `--debug`              | `-v`  | Print debug logs                            |               |
| `--help`               |       | Shows help text                             |               |

### Examples

#### Save the Current Session

```bash
$ hyprsession --save-session
```

#### Restore the Last Session

```bash
$ hyprsession --restore-session
```

#### Disable Auto-Save for a Single Command

```bash
$ hyprsession --save-session --auto-save=false
```

## Development

HyprSession was initially developed with [Bun.js](https://bun.sh) and compiled into a binary. Contributions are welcome! Feel free to open issues or pull requests to improve the tool.

## License

This project is licensed under the [GPL-3.0 License](LICENSE).

## Acknowledgments

- [Hyprland](https://hyprland.org) - The dynamic tiling window manager for Linux.
- [Bun.js](https://bun.sh) - A modern JavaScript runtime that helped bootstrap this project.
