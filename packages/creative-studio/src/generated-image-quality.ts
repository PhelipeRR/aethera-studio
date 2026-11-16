import sharp from 'sharp';

export interface GeneratedImageQualityFinding {
  code: 'INVALID_IMAGE' | 'DIMENSION_MISMATCH' | 'NEAR_UNIFORM_IMAGE';
  severity: 'critical' | 'warning';
  message: string;
}

export interface GeneratedImageQualityAudit {
  evaluatorId: 'sharp-image-structure-audit';
  passed: boolean;
  metrics: {
    width?: number;
    height?: number;
    channels?: number;
    format?: string;
    lumaStdDev: number;
  };
  findings: GeneratedImageQualityFinding[];
}

export interface GeneratedImageQualityOptions {
  expectedWidth?: number;
  expectedHeight?: number;
  minLumaStdDev?: number;
}

export async function auditGeneratedImage(buffer: Buffer, options?: GeneratedImageQualityOptions): Promise<GeneratedImageQualityAudit> {
  const minLumaStdDev = options?.minLumaStdDev ?? 5;
  try {
    const image = sharp(buffer);
    const metadata = await image.metadata();
    const grayscaleStats = await sharp(buffer).greyscale().stats();
    const lumaStdDev = grayscaleStats.channels[0]?.stdev ?? 0;
    const findings: GeneratedImageQualityFinding[] = [];
    if (!metadata.width || !metadata.height) {
      findings.push({ code: 'INVALID_IMAGE', severity: 'critical', message: 'Generated buffer has no readable image dimensions.' });
    } else if (
      (options?.expectedWidth !== undefined && metadata.width !== options.expectedWidth) ||
      (options?.expectedHeight !== undefined && metadata.height !== options.expectedHeight)
    ) {
      findings.push({
        code: 'DIMENSION_MISMATCH',
        severity: 'critical',
        message: `Generated image is ${metadata.width}×${metadata.height}; expected ${options?.expectedWidth ?? '?'}×${options?.expectedHeight ?? '?'}.`,
      });
    }
    if (lumaStdDev < minLumaStdDev) {
      findings.push({
        code: 'NEAR_UNIFORM_IMAGE',
        severity: 'critical',
        message: `Generated image has near-uniform luminance (σ=${lumaStdDev.toFixed(2)}); composition is likely empty.`,
      });
    }
    return {
      evaluatorId: 'sharp-image-structure-audit',
      passed: findings.every((finding) => finding.severity !== 'critical'),
      metrics: {
        ...(metadata.width ? { width: metadata.width } : {}),
        ...(metadata.height ? { height: metadata.height } : {}),
        ...(metadata.channels ? { channels: metadata.channels } : {}),
        ...(metadata.format ? { format: metadata.format } : {}),
        lumaStdDev,
      },
      findings,
    };
  } catch (error) {
    return {
      evaluatorId: 'sharp-image-structure-audit',
      passed: false,
      metrics: { lumaStdDev: 0 },
      findings: [{ code: 'INVALID_IMAGE', severity: 'critical', message: `Generated buffer is not a readable image: ${error instanceof Error ? error.message : String(error)}` }],
    };
  }
}
