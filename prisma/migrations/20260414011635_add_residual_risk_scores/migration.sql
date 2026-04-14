-- AlterTable
ALTER TABLE "RiskAssessment" ADD COLUMN     "residualBiasScore" DOUBLE PRECISION,
ADD COLUMN     "residualFairnessScore" DOUBLE PRECISION,
ADD COLUMN     "residualOverallScore" DOUBLE PRECISION,
ADD COLUMN     "residualPerformanceScore" DOUBLE PRECISION,
ADD COLUMN     "residualPrivacyScore" DOUBLE PRECISION,
ADD COLUMN     "residualSecurityScore" DOUBLE PRECISION,
ADD COLUMN     "residualTransparencyScore" DOUBLE PRECISION;
