//go:build windows

package collect

import (
	"os"
	"path/filepath"
)

// Windows locations for the `agents` collector. `configDir` is %APPDATA%
// (os.UserConfigDir). Every path is a fixed, documented location.
func mcpConfigFiles(home, configDir string) []configFile {
	files := commonMCPConfigFiles(home, configDir)
	programFiles := os.Getenv("ProgramFiles")
	if programFiles == "" {
		programFiles = `C:\Program Files`
	}
	if configDir != "" {
		files = append(files,
			configFile{client: ClientZed, path: filepath.Join(configDir, "Zed", "settings.json"), format: formatZed},
			configFile{client: ClientWindsurf, path: filepath.Join(configDir, "devin", "mcp_config.json"), format: formatMCPServers},
		)
	}
	files = append(files, configFile{
		client: ClientClaudeCode,
		path:   filepath.Join(programFiles, "ClaudeCode", "managed-mcp.json"),
		format: formatMCPServers,
	})
	if localAppData := os.Getenv("LOCALAPPDATA"); localAppData != "" {
		// Claude Desktop installed from the Microsoft Store (MSIX) keeps its
		// roaming data in the package's virtualized LocalCache.
		files = append(files, configFile{
			client: ClientClaudeDesktop,
			path: filepath.Join(localAppData, "Packages", "Claude_pzs8sxrjxfjjc",
				"LocalCache", "Roaming", "Claude", "claude_desktop_config.json"),
			format: formatMCPServers,
		})
	}
	return files
}

func frameworkLocations(home, configDir string) []frameworkLocation {
	py := func(pattern, source string) frameworkLocation {
		return frameworkLocation{pattern: pattern, ecosystem: "python", source: source}
	}
	node := func(pattern, source string) frameworkLocation {
		return frameworkLocation{pattern: pattern, ecosystem: "node", source: source}
	}
	var locations []frameworkLocation
	if configDir != "" {
		locations = append(locations,
			py(filepath.Join(configDir, "Python", "Python3*", "site-packages"), "user_site"),
			py(filepath.Join(configDir, "uv", "data", "tools", "*", "Lib", "site-packages"), "uv_tool"),
			node(filepath.Join(configDir, "npm", "node_modules"), "npm_global"),
			node(filepath.Join(configDir, "nvm", "v*", "node_modules"), "npm_global"),
		)
	}
	if home != "" {
		locations = append(locations,
			py(filepath.Join(home, "pipx", "venvs", "*", "Lib", "site-packages"), "pipx"),
			py(filepath.Join(home, "miniconda3", "Lib", "site-packages"), "conda"),
			py(filepath.Join(home, "anaconda3", "Lib", "site-packages"), "conda"),
			py(filepath.Join(home, "miniforge3", "Lib", "site-packages"), "conda"),
			node(filepath.Join(home, ".bun", "install", "global", "node_modules"), "npm_global"),
		)
	}
	if localAppData := os.Getenv("LOCALAPPDATA"); localAppData != "" {
		locations = append(locations,
			py(filepath.Join(localAppData, "Programs", "Python", "Python3*", "Lib", "site-packages"), "system_site"),
			py(filepath.Join(localAppData, "pipx", "pipx", "venvs", "*", "Lib", "site-packages"), "pipx"),
		)
	}
	return locations
}
