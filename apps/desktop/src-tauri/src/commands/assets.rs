use base64::{engine::general_purpose::STANDARD, Engine};
use std::{
    fs,
    path::{Path, PathBuf},
};
use url::Url;

use super::{read_error, MdvError};

#[tauri::command]
pub fn resolve_image_src(src: String, markdown_path: String) -> Result<String, MdvError> {
    if is_browser_safe_src(&src) {
        return Ok(src);
    }

    let markdown_path = PathBuf::from(markdown_path);
    let base_dir = markdown_path.parent().ok_or_else(|| {
        MdvError::new(
            "InvalidAssetBase",
            "Could not resolve Markdown file directory.",
        )
        .with_path(markdown_path.display().to_string())
    })?;
    let base_dir = base_dir
        .canonicalize()
        .map_err(|error| read_error(base_dir, error))?;

    let asset_path = local_asset_path(&src)?;
    let candidate = if asset_path.is_absolute() {
        asset_path
    } else {
        base_dir.join(asset_path)
    };
    let canonical = candidate
        .canonicalize()
        .map_err(|error| read_error(&candidate, error))?;

    if !canonical.starts_with(&base_dir) {
        return Err(MdvError::new(
            "PermissionDenied",
            "Image path is outside the opened Markdown directory.",
        )
        .with_path(canonical.display().to_string()));
    }

    let mime = mime_guess::from_path(&canonical).first_or_octet_stream();
    if !mime.essence_str().starts_with("image/") {
        return Err(
            MdvError::new("InvalidImage", "Referenced asset is not an image.")
                .with_path(canonical.display().to_string()),
        );
    }

    let bytes = fs::read(&canonical).map_err(|error| read_error(&canonical, error))?;
    Ok(format!(
        "data:{};base64,{}",
        mime.essence_str(),
        STANDARD.encode(bytes)
    ))
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), MdvError> {
    let parsed = Url::parse(&url).map_err(|error| {
        MdvError::new("InvalidUrl", "Invalid external URL.").with_details(error.to_string())
    })?;

    if !matches!(parsed.scheme(), "http" | "https" | "mailto") {
        return Err(MdvError::new(
            "UnsupportedUrl",
            "Only http, https, and mailto links can be opened externally.",
        )
        .with_path(url));
    }

    open::that(parsed.as_str()).map_err(|error| {
        MdvError::new("OpenUrlError", "Could not open external URL.")
            .with_details(error.to_string())
    })
}

#[tauri::command]
pub fn import_document_asset(
    source_path: String,
    document_path: String,
) -> Result<String, MdvError> {
    let source = PathBuf::from(&source_path)
        .canonicalize()
        .map_err(|error| read_error(Path::new(&source_path), error))?;
    let document = PathBuf::from(&document_path)
        .canonicalize()
        .map_err(|error| read_error(Path::new(&document_path), error))?;
    let document_dir = document.parent().ok_or_else(|| {
        MdvError::new(
            "InvalidAssetBase",
            "Could not resolve Markdown file directory.",
        )
        .with_path(document.display().to_string())
    })?;

    let metadata = fs::metadata(&source).map_err(|error| read_error(&source, error))?;
    if !metadata.is_file() {
        return Err(
            MdvError::new("InvalidImage", "Dropped asset is not a file.")
                .with_path(source.display().to_string()),
        );
    }

    let mime = mime_guess::from_path(&source).first_or_octet_stream();
    if !mime.essence_str().starts_with("image/") {
        return Err(
            MdvError::new("InvalidImage", "Dropped asset is not an image.")
                .with_path(source.display().to_string()),
        );
    }

    if source.starts_with(document_dir) {
        return relative_asset_path(&source, document_dir);
    }

    let asset_dir = document_dir.join("assets");
    fs::create_dir_all(&asset_dir).map_err(|error| {
        MdvError::new("AssetImportError", "Could not create the asset folder.")
            .with_path(asset_dir.display().to_string())
            .with_details(error.to_string())
    })?;

    let destination = unique_asset_destination(&asset_dir, &source)?;
    fs::copy(&source, &destination).map_err(|error| {
        MdvError::new(
            "AssetImportError",
            "Could not copy this image into the document folder.",
        )
        .with_path(destination.display().to_string())
        .with_details(error.to_string())
    })?;

    relative_asset_path(&destination, document_dir)
}

fn is_browser_safe_src(src: &str) -> bool {
    src.starts_with('#')
        || src.starts_with("data:")
        || src.starts_with("blob:")
        || src.starts_with("http://")
        || src.starts_with("https://")
}

fn unique_asset_destination(asset_dir: &Path, source: &Path) -> Result<PathBuf, MdvError> {
    let fallback_name = "image";
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(fallback_name);
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");

    for index in 0..1000 {
        let file_name = if index == 0 {
            if extension.is_empty() {
                stem.to_string()
            } else {
                format!("{stem}.{extension}")
            }
        } else if extension.is_empty() {
            format!("{stem}-{index}")
        } else {
            format!("{stem}-{index}.{extension}")
        };
        let candidate = asset_dir.join(file_name);

        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err(MdvError::new(
        "AssetImportError",
        "Could not find an available asset filename.",
    )
    .with_path(asset_dir.display().to_string()))
}

fn relative_asset_path(path: &Path, base: &Path) -> Result<String, MdvError> {
    let relative = path.strip_prefix(base).map_err(|_| {
        MdvError::new(
            "AssetImportError",
            "Imported asset is outside the document folder.",
        )
        .with_path(path.display().to_string())
    })?;

    Ok(relative
        .components()
        .filter_map(|component| component.as_os_str().to_str())
        .collect::<Vec<_>>()
        .join("/"))
}

fn local_asset_path(src: &str) -> Result<PathBuf, MdvError> {
    let without_suffix = src.split(['?', '#']).next().unwrap_or(src).trim();

    if without_suffix.starts_with("file://") {
        let url = Url::parse(without_suffix).map_err(|error| {
            MdvError::new("InvalidAssetUrl", "Invalid file URL.").with_details(error.to_string())
        })?;
        return url.to_file_path().map_err(|_| {
            MdvError::new("InvalidAssetUrl", "Could not convert file URL to a path.")
        });
    }

    Ok(PathBuf::from(without_suffix))
}
