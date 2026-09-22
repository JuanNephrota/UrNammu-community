// Command urnammu-agent is the UrNammu endpoint AI-activity collector.
//
// It reports which AI tools a machine runs and reaches — installed and running
// AI applications, allowlisted AI hostnames from browser history and the DNS
// cache, and local inference runtimes listening on loopback. It never reports
// content: no prompts, no responses, no URL paths, no window titles, no file
// paths. See ops/endpoint-agent/README.md.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/certifid/urnammu-endpoint-agent/internal/agent"
)

// version is stamped at build time with -ldflags "-X main.version=x.y.z".
var version = "dev"

func main() {
	var (
		configPath  = flag.String("config", "", "path to agent.json (defaults to the platform location)")
		once        = flag.Bool("once", false, "run a single collection cycle and exit")
		showVersion = flag.Bool("version", false, "print the agent version and exit")
		dryRun      = flag.Bool("dry-run", false, "collect and print the report without sending it")
	)
	flag.Parse()

	if *showVersion {
		fmt.Println(version)
		return
	}

	logger := log.New(os.Stderr, "urnammu-agent: ", log.LstdFlags|log.LUTC)

	cfg, err := agent.LoadConfig(*configPath)
	if err != nil {
		logger.Printf("configuration error: %v", err)
		os.Exit(2)
	}

	a, err := agent.New(cfg, version, logger)
	if err != nil {
		logger.Printf("startup error: %v", err)
		os.Exit(1)
	}

	// SIGTERM is what launchd and a Windows service stop send. Handling it
	// lets an in-flight cycle finish its spool write, so a stop during
	// collection does not lose the cycle.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if *dryRun {
		if err := a.DryRun(ctx, os.Stdout); err != nil {
			logger.Printf("dry run failed: %v", err)
			os.Exit(1)
		}
		return
	}

	if *once {
		if err := a.RunOnce(ctx); err != nil {
			logger.Printf("run failed: %v", err)
			os.Exit(1)
		}
		return
	}

	if err := a.Run(ctx); err != nil && ctx.Err() == nil {
		logger.Printf("agent stopped: %v", err)
		os.Exit(1)
	}
}
