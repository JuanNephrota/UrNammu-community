package collect

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Agent framework detection.
//
// Cheap by construction: a fixed list of package directories is listed (one
// ReadDir each) or probed (one Stat per known package), and nothing is ever
// opened or walked recursively. That keeps it unprivileged and imperceptible,
// and it is also its limit — a framework installed only inside a project's
// own virtualenv or node_modules is not seen, because finding those would
// mean crawling the home directory, which this agent does not do.
//
// What leaves the machine is the framework id, the ecosystem, the kind of
// location ("pipx", "user_site", …) and how many environments had it. No
// path, no version, no environment name.

// frameworkLocation is one directory to inspect.
type frameworkLocation struct {
	// pattern is a path or a filepath.Glob pattern.
	pattern string
	// ecosystem is "python" (a site-packages dir) or "node" (a node_modules dir).
	ecosystem string
	// source is the reportable location kind.
	source string
}

// Python distributions, by PEP 503-normalized name with `-` → `_`, as they
// appear in `<name>-<version>.dist-info` directory names.
var pythonFrameworks = map[string]string{
	"langchain":         "langchain",
	"langchain_core":    "langchain",
	"langgraph":         "langgraph",
	"crewai":            "crewai",
	"autogen":           "autogen",
	"autogen_agentchat": "autogen",
	"autogen_core":      "autogen",
	"pyautogen":         "autogen",
	"ag2":               "autogen",
	"llama_index":       "llama_index",
	"llama_index_core":  "llama_index",
	"pydantic_ai":       "pydantic_ai",
	"pydantic_ai_slim":  "pydantic_ai",
	"openai_agents":     "openai_agents",
	"claude_agent_sdk":  "claude_agent_sdk",
	"semantic_kernel":   "semantic_kernel",
	"smolagents":        "smolagents",
	"haystack_ai":       "haystack",
	"agno":              "agno",
	"google_adk":        "google_adk",
	"strands_agents":    "strands",
}

// Node packages, probed by exact directory under node_modules.
var nodeFrameworks = map[string]string{
	"@anthropic-ai/claude-agent-sdk": "claude_agent_sdk",
	"@openai/agents":                 "openai_agents",
	"@mastra/core":                   "mastra",
	"langchain":                      "langchain",
	"@langchain/core":                "langchain",
	"@langchain/langgraph":           "langgraph",
	"llamaindex":                     "llama_index",
	"@strands-agents/sdk":            "strands",
	"@google/adk":                    "google_adk",
}

// collectFrameworks inspects each location and aggregates per
// (framework, ecosystem, source). `scanned` is the number of directories
// actually read.
func collectFrameworks(locations []frameworkLocation, deadline time.Time) ([]AgentFramework, int, bool) {
	type key struct{ framework, ecosystem, source string }
	counts := map[key]int{}
	scanned := 0
	truncated := false

	for _, loc := range locations {
		dirs, _ := filepath.Glob(loc.pattern)
		sort.Strings(dirs)
		for _, dir := range dirs {
			if scanned >= maxFrameworkDirs || (!deadline.IsZero() && time.Now().After(deadline)) {
				truncated = true
				break
			}
			info, err := os.Stat(dir)
			if err != nil || !info.IsDir() {
				continue
			}
			scanned++

			var found map[string]struct{}
			if loc.ecosystem == "node" {
				found = nodeFrameworksIn(dir)
			} else {
				found = pythonFrameworksIn(dir)
			}
			for framework := range found {
				counts[key{framework, loc.ecosystem, loc.source}]++
			}
		}
	}

	out := make([]AgentFramework, 0, len(counts))
	for k, n := range counts {
		out = append(out, AgentFramework{
			Framework: k.framework,
			Ecosystem: k.ecosystem,
			Source:    k.source,
			Count:     n,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if a.Framework != b.Framework {
			return a.Framework < b.Framework
		}
		if a.Ecosystem != b.Ecosystem {
			return a.Ecosystem < b.Ecosystem
		}
		return a.Source < b.Source
	})
	return out, scanned, truncated
}

// pythonFrameworksIn lists one site-packages directory. Only entry *names*
// are read; no metadata file is opened.
func pythonFrameworksIn(dir string) map[string]struct{} {
	found := map[string]struct{}{}
	f, err := os.Open(dir)
	if err != nil {
		return found
	}
	defer f.Close()
	names, _ := f.Readdirnames(maxSitePackageEntries)
	for _, name := range names {
		if framework, ok := pythonFrameworks[distributionName(name)]; ok {
			found[framework] = struct{}{}
		}
	}
	return found
}

// distributionName extracts the normalized project name from a
// `name-version.dist-info` / `.egg-info` entry. Anything else yields "".
func distributionName(entry string) string {
	lower := strings.ToLower(entry)
	var stem string
	switch {
	case strings.HasSuffix(lower, ".dist-info"):
		stem = strings.TrimSuffix(lower, ".dist-info")
	case strings.HasSuffix(lower, ".egg-info"):
		stem = strings.TrimSuffix(lower, ".egg-info")
	default:
		return ""
	}
	if i := strings.Index(stem, "-"); i >= 0 {
		stem = stem[:i]
	}
	return pypiSeparators.ReplaceAllString(stem, "_")
}

func nodeFrameworksIn(dir string) map[string]struct{} {
	found := map[string]struct{}{}
	for pkg, framework := range nodeFrameworks {
		parts := strings.Split(pkg, "/")
		manifest := filepath.Join(append(append([]string{dir}, parts...), "package.json")...)
		if info, err := os.Stat(manifest); err == nil && info.Mode().IsRegular() {
			found[framework] = struct{}{}
		}
	}
	return found
}
