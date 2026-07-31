#!/usr/bin/env node
import { getConfig } from './config.js';
import { GithubArchiveMcpServer } from './server.js';

const server = new GithubArchiveMcpServer(getConfig());
await server.startStdio();
