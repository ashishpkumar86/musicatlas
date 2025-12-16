# Makefile for Music Atlas v2 backend

.PHONY: run run-prod

run:
	uvicorn app.main:app --reload

run-prod:
	uvicorn app.main:app --host 0.0.0.0 --port 8000
