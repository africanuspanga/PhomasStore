import multer from "multer";
import { authenticateAdminRequest } from "../_auth.ts";
import { ProductMapping } from "../../../server/productMapping.ts";
import { storage } from "../../../server/storage.ts";
import { ecountApi } from "../../../server/ecountApi.ts";

const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
    files: 1,
  },
});

const allowedExtensions = new Set([".xlsx", ".xls", ".csv"]);

export const config = {
  api: {
    bodyParser: false,
  },
};

function runMiddleware(req: any, res: any, middleware: any) {
  return new Promise<void>((resolve, reject) => {
    middleware(req, res, (result: any) => {
      if (result) {
        reject(result);
        return;
      }

      resolve();
    });
  });
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const auth = await authenticateAdminRequest(req);
    if (!auth.ok) {
      return res.status(auth.status).json({ message: auth.message });
    }

    try {
      await runMiddleware(req, res, excelUpload.single("file"));
    } catch (error) {
      console.error("Standalone product-mapping upload middleware failed:", error);
      return res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to parse uploaded Excel file",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No Excel file provided",
      });
    }

    const originalName = req.file.originalname || "product-mapping.xlsx";
    const extension = originalName.includes(".")
      ? originalName.slice(originalName.lastIndexOf(".")).toLowerCase()
      : ".xlsx";

    if (!allowedExtensions.has(extension)) {
      return res.status(400).json({
        success: false,
        message: "Invalid file type. Please upload .xlsx, .xls, or .csv",
      });
    }

    const uploadResult = await ProductMapping.replaceUploadedExcel({
      buffer: req.file.buffer,
      originalName,
    });

    const mappingStats = ProductMapping.getStats();
    const imageMappings = ProductMapping.getImageMappings();
    let importedImages = 0;
    let failedImageImports = 0;

    if (imageMappings.length > 0) {
      const batchSize = 25;

      for (let i = 0; i < imageMappings.length; i += batchSize) {
        const batch = imageMappings.slice(i, i + batchSize);
        const results = await Promise.allSettled(
          batch.map((mapping) => storage.setProductImage(mapping.code, mapping.imageUrl))
        );

        for (const result of results) {
          if (result.status === "fulfilled") {
            importedImages++;
          } else {
            failedImageImports++;
          }
        }
      }
    }

    ecountApi.clearInventoryCache();

    return res.status(200).json({
      success: true,
      message: "Excel mapping replaced successfully",
      data: {
        fileName: uploadResult.fileName,
        filePath: uploadResult.filePath,
        storageMode: uploadResult.storageMode,
        totalMapped: mappingStats.totalMapped,
        productsWithImages: mappingStats.productsWithImages,
        importedImages,
        failedImageImports,
        lastLoadedAt: mappingStats.lastLoadedAt,
      },
    });
  } catch (error) {
    console.error("Standalone product-mapping upload endpoint failed:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to upload product mapping Excel",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
