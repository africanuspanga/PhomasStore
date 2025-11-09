import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Upload, X, Image as ImageIcon, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface ImageUploadProps {
  onImageUploaded?: (imageUrl: string) => void;
  currentImage?: string;
  className?: string;
}

export function ImageUpload({ onImageUploaded, currentImage, className }: ImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentImage || null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFileUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast({
        title: "Invalid file type",
        description: "Please select an image file (JPG, PNG, GIF, etc.)",
        variant: "destructive",
      });
      return;
    }

    if (file.size > 5 * 1024 * 1024) { // 5MB limit
      toast({
        title: "File too large",
        description: "Please select an image smaller than 5MB",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    try {
      // Get Cloudinary config from backend with timeout
      const configController = new AbortController();
      const configTimeout = setTimeout(() => configController.abort(), 10000);
      
      const configResponse = await fetch('/api/cloudinary-config', {
        signal: configController.signal
      });
      clearTimeout(configTimeout);
      
      if (!configResponse.ok) {
        throw new Error(`Failed to get Cloudinary config: ${configResponse.status}`);
      }
      
      const config = await configResponse.json();
      console.log('📸 Cloudinary config:', { cloudName: config.cloudName, uploadPreset: config.uploadPreset });
      
      if (!config.cloudName || !config.uploadPreset) {
        throw new Error('Cloudinary configuration is incomplete');
      }
      
      // Direct upload to Cloudinary - no server proxy!
      const formData = new FormData();
      formData.append('file', file);
      formData.append('upload_preset', config.uploadPreset);
      
      // Direct upload to Cloudinary with extended timeout
      const uploadController = new AbortController();
      const uploadTimeout = setTimeout(() => uploadController.abort(), 180000); // 3 minute timeout (was 60 seconds)
      
      console.log('📤 Starting upload to Cloudinary...');
      const response = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`, {
        method: 'POST',
        body: formData,
        signal: uploadController.signal
      });
      clearTimeout(uploadTimeout);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Cloudinary upload error:', {
          status: response.status,
          statusText: response.statusText,
          errorData,
          uploadPreset: config.uploadPreset,
          cloudName: config.cloudName
        });
        throw new Error(`Upload failed: ${response.status} - ${errorData.error?.message || response.statusText}`);
      }

      const result = await response.json();
      console.log('Cloudinary upload successful:', result);
      const imageUrl = result.secure_url;

      if (!imageUrl) {
        console.error('No secure_url in Cloudinary response:', result);
        throw new Error('Cloudinary did not return an image URL');
      }

      setPreviewUrl(imageUrl);
      onImageUploaded?.(imageUrl);
      toast({
        title: "Image uploaded successfully",
        description: "Direct upload to Cloudinary completed",
      });
    } catch (error) {
      // Handle timeout/abort errors specifically
      if (error instanceof Error && error.name === 'AbortError') {
        console.error('Upload timeout - request took too long');
        toast({
          title: "Upload timeout",
          description: "The upload took too long and was cancelled. Please try a smaller image or check your connection.",
          variant: "destructive",
        });
      } else {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('Direct Cloudinary upload error:', {
          error,
          message: errorMessage,
          name: error instanceof Error ? error.name : 'Unknown',
          stack: error instanceof Error ? error.stack : undefined
        });
        toast({
          title: "Upload failed",
          description: errorMessage || "Failed to upload directly to Cloudinary. Please try again.",
          variant: "destructive",
        });
      }
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileUpload(files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileUpload(files[0]);
    }
  };

  const clearImage = () => {
    setPreviewUrl(null);
    onImageUploaded?.('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <Card className={className}>
      <CardContent className="p-6">
        <div className="space-y-4">
          {previewUrl ? (
            <div className="relative">
              <img
                src={previewUrl}
                alt="Product preview"
                className="w-full h-48 object-cover rounded-lg border"
                data-testid="image-preview"
              />
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="absolute top-2 right-2"
                onClick={clearImage}
                data-testid="button-clear-image"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                dragActive 
                  ? 'border-blue-500 bg-blue-50' 
                  : 'border-gray-300 hover:border-gray-400'
              }`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              data-testid="drop-zone"
            >
              <ImageIcon className="w-12 h-12 mx-auto text-gray-400 mb-4" />
              <p className="text-sm text-gray-600 mb-4">
                Drag and drop an image here, or click to select
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                data-testid="button-select-image"
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Select Image
                  </>
                )}
              </Button>
            </div>
          )}
          
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
            data-testid="input-file"
          />
          
          <div className="text-xs text-gray-500">
            <p>Supported formats: JPG, PNG, GIF, WebP</p>
            <p>Maximum size: 5MB</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}