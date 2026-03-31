import type { FileUIPart, UIMessage } from "ai";

const STORAGE_ATTACHMENT_PLACEHOLDER = "Attachment omitted from saved session";

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Failed to read file as data URL"));
    };

    reader.onerror = () => {
      reject(reader.error ?? new Error("Failed to read file"));
    };

    reader.readAsDataURL(file);
  });
}

export function isImageFilePart(part: unknown): part is FileUIPart {
  if (!part || typeof part !== "object") return false;

  const candidate = part as Partial<FileUIPart>;
  return (
    candidate.type === "file" &&
    typeof candidate.mediaType === "string" &&
    candidate.mediaType.startsWith("image/") &&
    typeof candidate.url === "string" &&
    candidate.url.length > 0
  );
}

export function extractImageFilesFromClipboard(
  clipboardData: DataTransfer | null,
): File[] {
  if (!clipboardData) return [];

  return Array.from(clipboardData.items)
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file instanceof File);
}

export async function createImageFileParts(
  files: File[],
): Promise<FileUIPart[]> {
  const imageFiles = files.filter((file) => file.type.startsWith("image/"));

  return Promise.all(
    imageFiles.map(async (file) => ({
      type: "file" as const,
      mediaType: file.type,
      filename: file.name,
      url: await readFileAsDataUrl(file),
    })),
  );
}

export function getImageFileParts(message: UIMessage): FileUIPart[] {
  return message.parts?.filter(isImageFilePart) ?? [];
}

export function stripFilePartsForStorage(messages: UIMessage[]): UIMessage[] {
  return messages.flatMap((message) => {
    const fileParts = message.parts?.filter(
      (part): part is FileUIPart => part.type === "file",
    ) ?? [];

    if (fileParts.length === 0) {
      return [message];
    }

    const preservedParts = message.parts?.filter((part) => part.type !== "file") ?? [];
    if (preservedParts.length > 0) {
      return [{ ...message, parts: preservedParts }];
    }

    return [{
      ...message,
      parts: [
        {
          type: "text",
          text:
            fileParts.length === 1
              ? STORAGE_ATTACHMENT_PLACEHOLDER
              : `${fileParts.length} attachments omitted from saved session`,
        },
      ],
    }];
  });
}
