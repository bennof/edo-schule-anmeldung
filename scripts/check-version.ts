// Release check: the tag (e.g. v0.2.0) must match every version in the
// project, so all artifacts report the same version.
//   node scripts/check-version.ts v0.2.0
import fs from 'node:fs';

const tag = process.argv[2] ?? '';
const expected = tag.replace(/^v/, '');
if (!/^\d+\.\d+\.\d+$/.test(expected)) {
    console.error(`Tag "${tag}" ist keine Version vX.Y.Z`);
    process.exit(1);
}

const cargo = (file: string) => /^version = "(.*)"/m.exec(fs.readFileSync(file, 'utf8'))?.[1];
const json = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8')).version as string | undefined;
const packages = ['apps', 'packages'].flatMap((dir) => fs.readdirSync(dir).map((name) => `${dir}/${name}/package.json`)).filter((f) => fs.existsSync(f));

const versions: [string, string | undefined][] = [
    ['server/Cargo.toml', cargo('server/Cargo.toml')],
    ['desktop/Cargo.toml', cargo('desktop/Cargo.toml')],
    ['desktop/tauri.conf.json', json('desktop/tauri.conf.json')],
    ...packages.map((f): [string, string | undefined] => [f, json(f)]),
];
const wrong = versions.filter(([, v]) => v !== expected);
for (const [file, v] of wrong) console.error(`${file}: ${v ?? 'keine Version'} statt ${expected}`);
if (wrong.length) process.exit(1);
console.log(`Version ${expected}: ${versions.length} Dateien stimmen überein`);
