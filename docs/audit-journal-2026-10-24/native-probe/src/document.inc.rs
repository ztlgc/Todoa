use serde_json::Value;
pub(crate) fn document(
    node: &Value,
    depth: usize,
    assets: &mut Vec<i64>,
    text: &mut String,
) -> Result<(), &'static str> {
    if depth > 64 {
        return Err("CONTENT_TOO_DEEP");
    }
    let kind = node["type"].as_str().ok_or("INVALID_CONTENT")?;
    if ![
        "doc",
        "paragraph",
        "text",
        "hardBreak",
        "heading",
        "bulletList",
        "orderedList",
        "listItem",
        "blockquote",
        "codeBlock",
        "horizontalRule",
        "image",
    ]
    .contains(&kind)
    {
        return Err("INVALID_CONTENT");
    }
    if kind == "doc" {
        if let Some(value) = node.get("attrs").and_then(|attrs| attrs.get("subtasks")) {
            let items = value.as_array().ok_or("INVALID_SUBTASKS")?;
            if items.len() > 500 {
                return Err("INVALID_SUBTASKS");
            }
            let mut ids = std::collections::HashSet::new();
            for item in items {
                let id = item["id"].as_str().ok_or("INVALID_SUBTASKS")?;
                let title = item["title"].as_str().ok_or("INVALID_SUBTASKS")?;
                let completed = item["completed"].as_bool().ok_or("INVALID_SUBTASKS")?;
                if id.is_empty()
                    || id.chars().count() > 100
                    || id.contains('\0')
                    || !ids.insert(id)
                    || title.trim().is_empty()
                    || title.chars().count() > 500
                    || title.contains('\0')
                {
                    return Err("INVALID_SUBTASKS");
                }
                if let Some(value) = item.get("dueDate") {
                    let date = value.as_str().ok_or("INVALID_SUBTASKS")?;
                    if date.len() != 10
                        || date.starts_with("0000")
                        || chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
                            .map(|parsed| parsed.to_string())
                            .as_deref()
                            != Ok(date)
                    {
                        return Err("INVALID_SUBTASKS");
                    }
                }
                if let Some(value) = item.get("dueAt") {
                    let at = value.as_str().ok_or("INVALID_SUBTASKS")?;
                    if item.get("dueDate").is_some()
                        || chrono::DateTime::parse_from_rfc3339(at).is_err()
                        || at.len() < 20
                        || at.len() > 35
                        || at.starts_with("0000")
                    {
                        return Err("INVALID_SUBTASKS");
                    }
                }
                text.push_str(if completed { "[x] " } else { "[ ] " });
                text.push_str(title.trim());
                text.push('\n');
            }
        }
    }
    if let Some(marks) = node.get("marks") {
        for mark in marks.as_array().ok_or("INVALID_CONTENT")? {
            let t = mark["type"].as_str().ok_or("INVALID_CONTENT")?;
            if ![
                "bold",
                "italic",
                "underline",
                "strike",
                "highlight",
                "code",
                "link",
            ]
            .contains(&t)
            {
                return Err("INVALID_CONTENT");
            }
            if t == "link" {
                let href = mark["attrs"]["href"].as_str().ok_or("INVALID_LINK")?;
                if !href.starts_with("https://")
                    && !href.starts_with("http://")
                    && !href.starts_with("mailto:")
                {
                    return Err("INVALID_LINK");
                }
            }
        }
    }
    if kind == "text" {
        text.push_str(node["text"].as_str().ok_or("INVALID_CONTENT")?);
    }
    if kind == "image" {
        let src = node["attrs"]["src"].as_str().ok_or("INVALID_IMAGE")?;
        let id = src
            .strip_prefix("todoa-asset:")
            .ok_or("INVALID_IMAGE")?
            .parse::<i64>()
            .map_err(|_| "INVALID_IMAGE")?;
        if id <= 0 {
            return Err("INVALID_IMAGE");
        }
        assets.push(id);
    }
    if let Some(children) = node.get("content") {
        for child in children.as_array().ok_or("INVALID_CONTENT")? {
            document(child, depth + 1, assets, text)?;
        }
    }
    if ["paragraph", "heading", "hardBreak", "listItem"].contains(&kind) {
        text.push('\n');
    }
    Ok(())
}
