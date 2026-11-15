import type { ResourceRecord } from '../../../types/inspection';
import { isPlayableVideoCandidate } from '../../../utils/asset-explorer';
import { partitionAssetsByCategory } from './asset-filters';
import { ImageGallery } from './image-gallery';
import { VectorGallery } from './vector-gallery';
import { VideoGallery } from './video-gallery';

export function splitGalleryMedia(resources: ResourceRecord[]) {
  const partitioned = partitionAssetsByCategory(resources);
  const allImageFullViewItems = [
    ...partitioned.imageAssets,
    ...partitioned.vectorAssets,
  ];
  const validVideoAssets = partitioned.videoAssets.filter((resource) =>
    isPlayableVideoCandidate(resource),
  );
  const nonPlayableVideoAssets = partitioned.videoAssets.filter(
    (resource) => !isPlayableVideoCandidate(resource),
  );

  return {
    ...partitioned,
    allImageFullViewItems,
    validVideoAssets,
    nonPlayableVideoAssets,
  };
}

interface MediaGalleriesGridProps {
  inspectionId: string;
  sourcePageUrl?: string;
  imageAssets: ResourceRecord[];
  vectorAssets: ResourceRecord[];
  validVideoAssets: ResourceRecord[];
  showImages?: boolean;
  showVectors?: boolean;
  showVideos?: boolean;
  resolveInspectionId?: (resource: ResourceRecord) => string;
  onOpenFullView: (kind: 'image' | 'video', resourceId: string) => void;
}

export function MediaGalleriesGrid({
  inspectionId,
  sourcePageUrl,
  imageAssets,
  vectorAssets,
  validVideoAssets,
  showImages = imageAssets.length > 0,
  showVectors = vectorAssets.length > 0,
  showVideos = validVideoAssets.length > 0,
  resolveInspectionId,
  onOpenFullView,
}: MediaGalleriesGridProps) {
  return (
    <>
      {showImages ? (
        <ImageGallery
          inspectionId={inspectionId}
          images={imageAssets}
          sourcePageUrl={sourcePageUrl}
          resolveInspectionId={resolveInspectionId}
          onOpenFullView={(resourceId) => {
            onOpenFullView('image', resourceId);
          }}
        />
      ) : null}

      {showVectors ? (
        <VectorGallery
          inspectionId={inspectionId}
          vectors={vectorAssets}
          sourcePageUrl={sourcePageUrl}
          resolveInspectionId={resolveInspectionId}
          onOpenFullView={(resourceId) => {
            onOpenFullView('image', resourceId);
          }}
        />
      ) : null}

      {showVideos ? (
        <VideoGallery
          inspectionId={inspectionId}
          videos={validVideoAssets}
          sourcePageUrl={sourcePageUrl}
          resolveInspectionId={resolveInspectionId}
          onOpenFullView={(resourceId) => {
            onOpenFullView('video', resourceId);
          }}
        />
      ) : null}
    </>
  );
}
