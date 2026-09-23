//go:build windows

package collect

import "os"

// openConfigFile: Windows has no FIFOs in the file system namespace (named
// pipes live under \\.\pipe\), so a plain open cannot block.
func openConfigFile(path string) (*os.File, error) {
	return os.Open(path)
}
