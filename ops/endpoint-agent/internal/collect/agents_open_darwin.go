//go:build darwin

package collect

import (
	"os"
	"syscall"
)

// openConfigFile opens read-only and non-blocking: opening a FIFO for reading
// otherwise blocks until a writer appears, which would stall the whole
// collection cycle. O_NONBLOCK has no effect on regular files.
func openConfigFile(path string) (*os.File, error) {
	return os.OpenFile(path, os.O_RDONLY|syscall.O_NONBLOCK, 0)
}
