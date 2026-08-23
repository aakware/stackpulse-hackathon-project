import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

export interface FirmsCsvRecord {
    latitude: number;
    longitude: number;
    brightness: number | null;
    scan: number | null;
    track: number | null;
    acqDate: string;
    acqTime: string;
    satellite: string;
    instrument: string;
    confidence: string;
    version: string;
    brightT31: number | null;
    frp: number | null;
    daynight: string;
    type: number;
    createdAt: string;
}

export async function parseCsvFile(filePath: string): Promise<FirmsCsvRecord[]> {
    if (!fs.existsSync(filePath)) {
        console.warn(`File not found: ${filePath}`);
        return [];
    }

    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity,
    });

    let headers: string[] = [];
    const records: FirmsCsvRecord[] = [];
    let isHeader = true;

    for await (const line of rl) {
        if (!line.trim()) continue;
        if (isHeader) {
            headers = line.split(',').map((h) => h.trim());
            isHeader = false;
            continue;
        }

        const cols = line.split(',').map((c) => c.trim());
        if (cols.length < headers.length) continue;

        const row: Record<string, string> = {};
        headers.forEach((h, idx) => {
            row[h] = cols[idx];
        });

        records.push({
            latitude: parseFloat(row.latitude),
            longitude: parseFloat(row.longitude),
            brightness: row.brightness ? parseFloat(row.brightness) : null,
            scan: row.scan ? parseFloat(row.scan) : null,
            track: row.track ? parseFloat(row.track) : null,
            acqDate: row.acq_date || '2026-01-01',
            acqTime: row.acq_time || '0000',
            satellite: row.satellite || 'VIIRS',
            instrument: row.instrument || 'VIIRS',
            confidence: row.confidence || 'n',
            version: row.version || '2.0',
            brightT31: row.bright_t31 ? parseFloat(row.bright_t31) : null,
            frp: row.frp ? parseFloat(row.frp) : null,
            daynight: row.daynight || 'D',
            type: row.type !== undefined && row.type !== '' ? parseInt(row.type, 10) : 0,
            createdAt: new Date().toISOString(),
        });
    }

    return records;
}

export async function runSeeder() {
    const dsMlPath = path.resolve(__dirname, '../../../../.ds-ml/DL_FIRE_J1V-C2_790558');
    const archivePath = path.join(dsMlPath, 'fire_archive_J1V-C2_790558.csv');
    const nrtPath = path.join(dsMlPath, 'fire_nrt_J1V-C2_790558.csv');

    console.log('📖 Reading Archive CSV:', archivePath);
    const archiveRecords = await parseCsvFile(archivePath);
    console.log(`✅ Loaded ${archiveRecords.length.toLocaleString()} archive records.`);

    console.log('📖 Reading NRT CSV:', nrtPath);
    const nrtRecords = await parseCsvFile(nrtPath);
    console.log(`✅ Loaded ${nrtRecords.length.toLocaleString()} NRT records.`);

    const totalRecords = [...archiveRecords, ...nrtRecords];
    console.log(`🔥 Total raw records: ${totalRecords.length.toLocaleString()}`);

    // Deduplicate
    const uniqueMap = new Map<string, FirmsCsvRecord>();
    for (const r of totalRecords) {
        const key = `${r.latitude}_${r.longitude}_${r.acqDate}_${r.acqTime}`;
        if (!uniqueMap.has(key)) {
            uniqueMap.set(key, r);
        }
    }

    const uniqueRecords = Array.from(uniqueMap.values());
    console.log(`✨ Unique deduplicated records: ${uniqueRecords.length.toLocaleString()}`);

    // Generate chunked SQL files for D1 seeding
    const outputDir = path.resolve(__dirname, '../../seed-sql');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const chunkSize = 2000;
    const totalChunks = Math.ceil(uniqueRecords.length / chunkSize);
    console.log(`📦 Generating ${totalChunks} SQL seed batch files in ${outputDir}...`);

    for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
        const batch = uniqueRecords.slice(chunkIdx * chunkSize, (chunkIdx + 1) * chunkSize);
        const sqlLines: string[] = ['BEGIN TRANSACTION;'];

        for (const r of batch) {
            const values = [
                r.latitude,
                r.longitude,
                r.brightness ?? 'NULL',
                r.scan ?? 'NULL',
                r.track ?? 'NULL',
                `'${r.acqDate}'`,
                `'${r.acqTime}'`,
                `'${r.satellite}'`,
                `'${r.instrument}'`,
                `'${r.confidence}'`,
                `'${r.version}'`,
                r.brightT31 ?? 'NULL',
                r.frp ?? 'NULL',
                `'${r.daynight}'`,
                r.type,
                `'${r.createdAt}'`,
            ].join(', ');

            sqlLines.push(
                `INSERT OR IGNORE INTO heat_anomalies (latitude, longitude, brightness, scan, track, acq_date, acq_time, satellite, instrument, confidence, version, bright_t31, frp, daynight, type, created_at) VALUES (${values});`
            );
        }

        sqlLines.push('COMMIT;');
        const filePath = path.join(outputDir, `seed_part_${chunkIdx + 1}.sql`);
        fs.writeFileSync(filePath, sqlLines.join('\n'));
    }

    console.log(`🎉 Seeder complete! Generated ${totalChunks} seed SQL files.`);
}

runSeeder().catch(console.error);
