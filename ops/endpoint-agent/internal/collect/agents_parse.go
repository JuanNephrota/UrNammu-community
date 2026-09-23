package collect

import (
	"strconv"
	"strings"
)

// Minimal readers for the three non-JSON shapes MCP clients use. Each one
// understands only the handful of keys the collector needs and ignores
// everything else, which keeps them small enough to review and means an
// unexpected construct degrades to "server not seen" rather than a crash.
// A full YAML or TOML library would be the only non-trivial dependency added
// to a binary whose one dependency today is SQLite.

// StripJSONC turns JSON-with-comments (VS Code, Zed) into JSON: it removes
// `//` and `/* */` comments outside strings and drops trailing commas before
// `}` or `]`. Strings are copied verbatim, escapes included.
func StripJSONC(in []byte) []byte {
	out := make([]byte, 0, len(in))
	inString := false
	for i := 0; i < len(in); i++ {
		c := in[i]
		if inString {
			out = append(out, c)
			if c == '\\' && i+1 < len(in) {
				i++
				out = append(out, in[i])
			} else if c == '"' {
				inString = false
			}
			continue
		}
		switch {
		case c == '"':
			inString = true
			out = append(out, c)
		case c == '/' && i+1 < len(in) && in[i+1] == '/':
			for i < len(in) && in[i] != '\n' {
				i++
			}
			if i < len(in) {
				out = append(out, '\n')
			}
		case c == '/' && i+1 < len(in) && in[i+1] == '*':
			i += 2
			for i+1 < len(in) && !(in[i] == '*' && in[i+1] == '/') {
				i++
			}
			i++ // land on the closing '/'
		case c == '}' || c == ']':
			// Drop a trailing comma: walk back over whitespace in `out`.
			j := len(out) - 1
			for j >= 0 && isJSONSpace(out[j]) {
				j--
			}
			if j >= 0 && out[j] == ',' {
				out = append(out[:j], out[j+1:]...)
			}
			out = append(out, c)
		default:
			out = append(out, c)
		}
	}
	return out
}

func isJSONSpace(c byte) bool {
	return c == ' ' || c == '\t' || c == '\n' || c == '\r'
}

// ─── Continue YAML ───────────────────────────────────────

// parseContinueYAML reads the top-level `mcpServers:` block-sequence of
// Continue's config.yaml and mcpServers/*.yaml files:
//
//	mcpServers:
//	  - name: sqlite
//	    type: stdio
//	    command: npx
//	    args: ["-y", "@modelcontextprotocol/server-sqlite"]   # or a block list
//	    env: { … }                                              # ignored
//
// Only name, type, command, url and args are read.
func parseContinueYAML(doc string) []rawServer {
	lines := strings.Split(strings.ReplaceAll(doc, "\r\n", "\n"), "\n")
	var out []rawServer
	var current *rawServer
	inBlock := false
	itemIndent := -1
	collectingArgs := false

	flush := func() {
		if current != nil && current.name != "" {
			out = append(out, *current)
		}
		current = nil
	}

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") || trimmed == "---" {
			continue
		}
		indent := len(line) - len(strings.TrimLeft(line, " "))
		isItem := strings.HasPrefix(trimmed, "- ") || trimmed == "-"

		// `mcpServers:` followed by items at column 0 is valid YAML too.
		if indent == 0 && !(inBlock && isItem) {
			if inBlock {
				flush()
				inBlock = false
			}
			if key, _ := yamlKeyValue(trimmed); key == "mcpServers" {
				inBlock = true
				itemIndent = -1
			}
			continue
		}
		if !inBlock {
			continue
		}

		if isItem {
			rest := strings.TrimSpace(strings.TrimPrefix(trimmed, "-"))
			if collectingArgs && current != nil && indent >= itemIndent {
				current.args = append(current.args, yamlScalar(rest))
				continue
			}
			// A new list item under mcpServers.
			flush()
			current = &rawServer{}
			// Keys line up with the text after the dash, however many spaces
			// follow it: `- name:` and `-   name:` are both valid.
			afterDash := trimmed[1:]
			itemIndent = indent + 1 + (len(afterDash) - len(strings.TrimLeft(afterDash, " ")))
			collectingArgs = false
			if rest != "" {
				applyYAMLKey(current, rest, &collectingArgs)
			}
			continue
		}

		if current == nil {
			continue
		}
		if indent == itemIndent {
			collectingArgs = false
			applyYAMLKey(current, trimmed, &collectingArgs)
		}
		// Deeper lines (env maps, nested objects) are ignored.
	}
	flush()
	return out
}

func applyYAMLKey(server *rawServer, text string, collectingArgs *bool) {
	key, value := yamlKeyValue(text)
	switch key {
	case "name":
		server.name = yamlScalar(value)
	case "type":
		server.typ = yamlScalar(value)
	case "command":
		server.command = yamlScalar(value)
	case "url":
		server.url = yamlScalar(value)
	case "disabled":
		server.disabled = yamlScalar(value) == "true"
	case "args":
		if value == "" {
			*collectingArgs = true
			return
		}
		server.args = yamlFlowList(value)
	}
}

// yamlKeyValue splits `key: value`, dropping an inline `# comment` from an
// unquoted value.
func yamlKeyValue(text string) (string, string) {
	i := strings.Index(text, ":")
	if i < 0 {
		return "", ""
	}
	key := strings.Trim(strings.TrimSpace(text[:i]), `"'`)
	value := strings.TrimSpace(text[i+1:])
	if value != "" && value[0] != '"' && value[0] != '\'' && value[0] != '[' {
		if j := strings.Index(value, " #"); j >= 0 {
			value = strings.TrimSpace(value[:j])
		}
	}
	return key, value
}

func yamlScalar(value string) string {
	v := strings.TrimSpace(value)
	if len(v) >= 2 && (v[0] == '"' && v[len(v)-1] == '"') {
		if unq, err := strconv.Unquote(v); err == nil {
			return unq
		}
		return v[1 : len(v)-1]
	}
	if len(v) >= 2 && v[0] == '\'' && v[len(v)-1] == '\'' {
		return strings.ReplaceAll(v[1:len(v)-1], "''", "'")
	}
	if j := strings.Index(v, " #"); j >= 0 {
		v = strings.TrimSpace(v[:j])
	}
	return v
}

// yamlFlowList parses `[a, "b", 'c']`.
func yamlFlowList(value string) []string {
	v := strings.TrimSpace(value)
	if !strings.HasPrefix(v, "[") {
		return nil
	}
	end := strings.LastIndex(v, "]")
	if end < 0 {
		return nil
	}
	var out []string
	for _, item := range splitOutsideQuotes(v[1:end], ',') {
		if s := yamlScalar(item); s != "" {
			out = append(out, s)
		}
	}
	return out
}

func splitOutsideQuotes(s string, sep byte) []string {
	var out []string
	var quote byte
	start := 0
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case quote != 0:
			if c == '\\' && quote == '"' {
				i++
			} else if c == quote {
				quote = 0
			}
		case c == '"' || c == '\'':
			quote = c
		case c == sep:
			out = append(out, s[start:i])
			start = i + 1
		}
	}
	return append(out, s[start:])
}

// ─── Codex TOML ──────────────────────────────────────────

// parseCodexTOML reads `[mcp_servers.<name>]` tables from ~/.codex/config.toml:
//
//	[mcp_servers.context7]
//	command = "npx"
//	args = ["-y", "@upstash/context7-mcp"]
//
//	[mcp_servers.figma]
//	url = "https://mcp.figma.com/mcp"
//	bearer_token_env_var = "FIGMA_OAUTH_TOKEN"   # ignored
//
// Sub-tables (`[mcp_servers.x.env]`) and every key other than command, args,
// url and enabled are ignored. Inline-table definitions under a bare
// `[mcp_servers]` table are not supported.
func parseCodexTOML(doc string) []rawServer {
	lines := strings.Split(strings.ReplaceAll(doc, "\r\n", "\n"), "\n")
	var out []*rawServer
	var current *rawServer

	for i := 0; i < len(lines); i++ {
		line := strings.TrimSpace(stripTOMLComment(lines[i]))
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "[") {
			current = nil
			if strings.HasPrefix(line, "[[") {
				continue
			}
			header := strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(line, "["), "]"))
			parts := splitTOMLKey(header)
			if len(parts) == 2 && parts[0] == "mcp_servers" && parts[1] != "" {
				current = &rawServer{name: parts[1]}
				out = append(out, current)
			}
			continue
		}
		if current == nil {
			continue
		}
		eq := strings.Index(line, "=")
		if eq < 0 {
			continue
		}
		key := strings.Trim(strings.TrimSpace(line[:eq]), `"'`)
		value := strings.TrimSpace(line[eq+1:])

		// Arrays may span lines; gather until the brackets balance. The scan
		// is incremental (each byte read once) and bounded, so an unclosed
		// bracket in a large file cannot stall the collection cycle.
		if strings.HasPrefix(value, "[") {
			var scanner tomlArrayScanner
			var b strings.Builder
			b.WriteString(value)
			scanner.feed(value)
			for extra := 0; !scanner.closed && i+1 < len(lines); extra++ {
				if extra >= maxTOMLArrayLines || b.Len() >= maxTOMLArrayBytes {
					value = "" // unterminated: drop the value rather than guess
					break
				}
				i++
				next := " " + strings.TrimSpace(stripTOMLComment(lines[i]))
				b.WriteString(next)
				scanner.feed(next)
			}
			if scanner.closed {
				value = b.String()
			}
		}

		switch key {
		case "command":
			current.command = tomlString(value)
		case "url":
			current.url = tomlString(value)
		case "args":
			current.args = tomlStringArray(value)
		case "enabled":
			if value == "false" {
				current.disabled = true
			}
		}
	}

	result := make([]rawServer, 0, len(out))
	for _, s := range out {
		result = append(result, *s)
	}
	return result
}

// stripTOMLComment removes a `#` comment that is outside any string.
func stripTOMLComment(line string) string {
	var quote byte
	for i := 0; i < len(line); i++ {
		c := line[i]
		switch {
		case quote != 0:
			if c == '\\' && quote == '"' {
				i++
			} else if c == quote {
				quote = 0
			}
		case c == '"' || c == '\'':
			quote = c
		case c == '#':
			return line[:i]
		}
	}
	return line
}

func splitTOMLKey(key string) []string {
	var parts []string
	for _, part := range splitOutsideQuotes(key, '.') {
		part = strings.TrimSpace(part)
		if len(part) >= 2 && (part[0] == '"' || part[0] == '\'') {
			part = tomlString(part)
		}
		parts = append(parts, part)
	}
	return parts
}

// Bounds on a multi-line TOML array; real Codex configs use a handful of lines.
const (
	maxTOMLArrayLines = 64
	maxTOMLArrayBytes = 64 << 10
)

// tomlArrayScanner tracks bracket depth and string state across fed chunks,
// so gathering a multi-line array is linear in its length.
type tomlArrayScanner struct {
	depth   int
	quote   byte
	escaped bool
	closed  bool
}

func (s *tomlArrayScanner) feed(chunk string) {
	for i := 0; i < len(chunk) && !s.closed; i++ {
		c := chunk[i]
		switch {
		case s.escaped:
			s.escaped = false
		case s.quote != 0:
			if c == '\\' && s.quote == '"' {
				s.escaped = true
			} else if c == s.quote {
				s.quote = 0
			}
		case c == '"' || c == '\'':
			s.quote = c
		case c == '[':
			s.depth++
		case c == ']':
			s.depth--
			if s.depth == 0 {
				s.closed = true
			}
		}
	}
}

// tomlArrayClosed reports whether value holds a complete bracketed array.
func tomlArrayClosed(value string) bool {
	var s tomlArrayScanner
	s.feed(value)
	return s.closed
}

func tomlString(value string) string {
	v := strings.TrimSpace(value)
	if len(v) >= 2 && v[0] == '"' && v[len(v)-1] == '"' {
		if unq, err := strconv.Unquote(v); err == nil {
			return unq
		}
		return v[1 : len(v)-1]
	}
	if len(v) >= 2 && v[0] == '\'' && v[len(v)-1] == '\'' {
		return v[1 : len(v)-1]
	}
	return ""
}

func tomlStringArray(value string) []string {
	v := strings.TrimSpace(value)
	if !strings.HasPrefix(v, "[") {
		return nil
	}
	end := strings.LastIndex(v, "]")
	if end < 0 {
		return nil
	}
	var out []string
	for _, item := range splitOutsideQuotes(v[1:end], ',') {
		if s := tomlString(item); s != "" {
			out = append(out, s)
		}
		if len(out) >= 64 {
			break
		}
	}
	return out
}
