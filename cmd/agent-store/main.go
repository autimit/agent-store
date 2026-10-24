package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"autimit.local/agent-store/internal/httpapi"
	"autimit.local/agent-store/internal/store"
)

func main() {
	defaultAddr := "127.0.0.1:8091"
	if port := strings.TrimSpace(os.Getenv("PORT")); port != "" {
		defaultAddr = "0.0.0.0:" + port
	}
	addr := flag.String("addr", envOr("AGENT_STORE_ADDR", defaultAddr), "endereço HTTP")
	catalogPath := flag.String("catalog", envOr("AGENT_STORE_CATALOG", "data/catalog.json"), "catálogo inicial")
	database := flag.String("db", envOr("AGENT_STORE_DB", ".runtime/agent-store.db"), "banco persistente de demonstração")
	flag.Parse()
	if err := run(*addr, *catalogPath, *database); err != nil {
		slog.Error("Agent Store encerrada", "error", err)
		os.Exit(1)
	}
}

func envOr(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}
func run(addr, catalogPath, database string) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	catalog, err := store.LoadCatalog(catalogPath)
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(database), 0700); err != nil {
		return err
	}
	s, err := store.Open(ctx, database, catalog)
	if err != nil {
		return err
	}
	defer s.Close()
	if err = os.Chmod(database, 0600); err != nil {
		return err
	}
	api := &httpapi.Server{Store: s, ImageDir: filepath.Join(filepath.Dir(catalogPath), "images")}
	server := &http.Server{Addr: addr, Handler: api.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 20 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32 << 10}
	done := make(chan error, 1)
	go func() {
		slog.Info("Agent Store disponível", "url", "http://"+addr, "mode", "simulação local; sem cobranças ou entregas reais")
		done <- server.ListenAndServe()
	}()
	select {
	case err = <-done:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return server.Shutdown(shutdown)
	}
}
