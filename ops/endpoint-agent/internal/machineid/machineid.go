// Package machineid resolves a stable per-machine identifier and OS version.
package machineid

import "errors"

var errNoMachineID = errors.New("machineid: no stable machine identifier available")
