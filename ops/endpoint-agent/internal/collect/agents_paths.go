package collect

import "path/filepath"

// commonMCPConfigFiles are the locations that have the same shape on macOS
// and Windows: dotfiles under the home directory, and per-app directories
// under the OS config dir (~/Library/Application Support or %APPDATA%).
//
// Checked against each client's documentation (2026-09): Claude Desktop,
// Claude Code, VS Code, Zed, Continue, Gemini CLI, Codex and Windsurf/Devin
// publish these paths. The Cline and Roo Code globalStorage paths are the
// extensions' long-standing locations rather than formally documented ones.
func commonMCPConfigFiles(home, configDir string) []configFile {
	var files []configFile
	if home != "" {
		files = append(files,
			// Claude Code: user scope and per-project local scope both live in
			// ~/.claude.json; settings.json is read in case it carries
			// servers; ~/.mcp.json covers a project rooted at home. Project
			// .mcp.json files elsewhere are deliberately not searched for —
			// that would mean crawling the disk.
			configFile{client: ClientClaudeCode, path: filepath.Join(home, ".claude.json"), format: formatClaudeJSON},
			configFile{client: ClientClaudeCode, path: filepath.Join(home, ".claude", "settings.json"), format: formatMCPServers},
			configFile{client: ClientClaudeCode, path: filepath.Join(home, ".mcp.json"), format: formatMCPServers},
			configFile{client: ClientCursor, path: filepath.Join(home, ".cursor", "mcp.json"), format: formatMCPServers},
			configFile{client: ClientWindsurf, path: filepath.Join(home, ".codeium", "windsurf", "mcp_config.json"), format: formatMCPServers},
			configFile{client: ClientGeminiCLI, path: filepath.Join(home, ".gemini", "settings.json"), format: formatGemini},
			configFile{client: ClientCodex, path: filepath.Join(home, ".codex", "config.toml"), format: formatCodexTOML},
			configFile{client: ClientContinue, path: filepath.Join(home, ".continue", "config.yaml"), format: formatContinueYAML},
			configFile{client: ClientContinue, path: filepath.Join(home, ".continue", "config.json"), format: formatContinueJSON},
			configFile{client: ClientContinue, path: filepath.Join(home, ".continue", "mcpServers", "*.yaml"), format: formatContinueYAML, glob: true},
			configFile{client: ClientContinue, path: filepath.Join(home, ".continue", "mcpServers", "*.yml"), format: formatContinueYAML, glob: true},
			configFile{client: ClientContinue, path: filepath.Join(home, ".continue", "mcpServers", "*.json"), format: formatMCPServers, glob: true},
		)
	}
	if configDir == "" {
		return files
	}

	files = append(files, configFile{
		client: ClientClaudeDesktop,
		path:   filepath.Join(configDir, "Claude", "claude_desktop_config.json"),
		format: formatMCPServers,
	})

	// VS Code and its forks: the user-profile mcp.json (`servers`) and the
	// older user settings.json form (`mcp.servers`).
	for _, app := range []string{"Code", "Code - Insiders", "VSCodium"} {
		user := filepath.Join(configDir, app, "User")
		files = append(files,
			configFile{client: ClientVSCode, path: filepath.Join(user, "mcp.json"), format: formatVSCodeMCP},
			configFile{client: ClientVSCode, path: filepath.Join(user, "settings.json"), format: formatVSCodeSettings},
		)
	}

	// Cline and Roo Code run inside VS Code and its forks; their MCP settings
	// live in the host editor's extension globalStorage.
	for _, app := range []string{"Code", "Code - Insiders", "VSCodium", "Cursor", "Windsurf"} {
		storage := filepath.Join(configDir, app, "User", "globalStorage")
		files = append(files,
			configFile{client: ClientCline, path: filepath.Join(storage, "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json"), format: formatMCPServers},
			configFile{client: ClientRooCode, path: filepath.Join(storage, "rooveterinaryinc.roo-cline", "settings", "mcp_settings.json"), format: formatMCPServers},
		)
	}
	return files
}
