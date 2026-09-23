//go:build darwin

package collect

import "path/filepath"

// macOS locations for the `agents` collector. `configDir` is
// ~/Library/Application Support (os.UserConfigDir). Every path is a fixed,
// documented location — nothing here is discovered by walking a directory.
func mcpConfigFiles(home, configDir string) []configFile {
	files := commonMCPConfigFiles(home, configDir)
	if home != "" {
		files = append(files,
			// Zed keeps its settings under ~/.config on macOS too.
			configFile{client: ClientZed, path: filepath.Join(home, ".config", "zed", "settings.json"), format: formatZed},
			// Windsurf's successor build (Devin desktop) moved the file here.
			configFile{client: ClientWindsurf, path: filepath.Join(home, ".config", "devin", "mcp_config.json"), format: formatMCPServers},
		)
	}
	// Claude Code's admin-managed servers (deployed by MDM).
	files = append(files, configFile{
		client: ClientClaudeCode,
		path:   "/Library/Application Support/ClaudeCode/managed-mcp.json",
		format: formatMCPServers,
	})
	return files
}

func frameworkLocations(home, _ string) []frameworkLocation {
	py := func(pattern, source string) frameworkLocation {
		return frameworkLocation{pattern: pattern, ecosystem: "python", source: source}
	}
	node := func(pattern, source string) frameworkLocation {
		return frameworkLocation{pattern: pattern, ecosystem: "node", source: source}
	}
	locations := []frameworkLocation{
		// Interpreter-wide installs: Homebrew, python.org.
		py("/opt/homebrew/lib/python3.*/site-packages", "system_site"),
		py("/usr/local/lib/python3.*/site-packages", "system_site"),
		py("/Library/Frameworks/Python.framework/Versions/3.*/lib/python3.*/site-packages", "system_site"),
		// Global npm installs (Homebrew / system node).
		node("/opt/homebrew/lib/node_modules", "npm_global"),
		node("/usr/local/lib/node_modules", "npm_global"),
	}
	if home == "" {
		return locations
	}
	return append(locations,
		// `pip install --user`
		py(filepath.Join(home, "Library", "Python", "3.*", "lib", "python", "site-packages"), "user_site"),
		py(filepath.Join(home, ".local", "lib", "python3.*", "site-packages"), "user_site"),
		// pyenv global interpreters.
		py(filepath.Join(home, ".pyenv", "versions", "*", "lib", "python3.*", "site-packages"), "system_site"),
		// CLI tool venvs.
		py(filepath.Join(home, ".local", "pipx", "venvs", "*", "lib", "python3.*", "site-packages"), "pipx"),
		py(filepath.Join(home, ".local", "share", "pipx", "venvs", "*", "lib", "python3.*", "site-packages"), "pipx"),
		py(filepath.Join(home, ".local", "share", "uv", "tools", "*", "lib", "python3.*", "site-packages"), "uv_tool"),
		// Conda base environments only — named envs are project territory.
		py(filepath.Join(home, "miniconda3", "lib", "python3.*", "site-packages"), "conda"),
		py(filepath.Join(home, "anaconda3", "lib", "python3.*", "site-packages"), "conda"),
		py(filepath.Join(home, "miniforge3", "lib", "python3.*", "site-packages"), "conda"),
		// User-level global npm/bun/pnpm installs.
		node(filepath.Join(home, ".npm-global", "lib", "node_modules"), "npm_global"),
		node(filepath.Join(home, ".nvm", "versions", "node", "*", "lib", "node_modules"), "npm_global"),
		node(filepath.Join(home, ".bun", "install", "global", "node_modules"), "npm_global"),
		node(filepath.Join(home, "Library", "pnpm", "global", "*", "node_modules"), "npm_global"),
	)
}
