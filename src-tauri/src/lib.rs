use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    Manager,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // File menu items
            let new_item = MenuItemBuilder::with_id("menu-new", "New")
                .accelerator("CmdOrCtrl+N")
                .build(app)?;
            let open_item = MenuItemBuilder::with_id("menu-open", "Open...")
                .accelerator("CmdOrCtrl+O")
                .build(app)?;
            let save_item = MenuItemBuilder::with_id("menu-save", "Save")
                .accelerator("CmdOrCtrl+S")
                .build(app)?;
            let save_as_item = MenuItemBuilder::with_id("menu-save-as", "Save As...")
                .accelerator("CmdOrCtrl+Shift+S")
                .build(app)?;
            let export_png_item =
                MenuItemBuilder::with_id("menu-export-png", "Export PNG...").build(app)?;
            let export_svg_item =
                MenuItemBuilder::with_id("menu-export-svg", "Export SVG...").build(app)?;
            let quit_item = PredefinedMenuItem::quit(app, Some("Quit"))?;

            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&new_item)
                .item(&open_item)
                .item(&save_item)
                .item(&save_as_item)
                .separator()
                .item(&export_png_item)
                .item(&export_svg_item)
                .separator()
                .item(&quit_item)
                .build()?;

            // Edit menu items
            let undo_item = MenuItemBuilder::with_id("menu-undo", "Undo")
                .accelerator("CmdOrCtrl+Z")
                .build(app)?;
            let redo_item = MenuItemBuilder::with_id("menu-redo", "Redo")
                .accelerator("CmdOrCtrl+Shift+Z")
                .build(app)?;

            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .item(&undo_item)
                .item(&redo_item)
                .build()?;

            // View menu items
            let zoom_in_item = MenuItemBuilder::with_id("menu-zoom-in", "Zoom In")
                .accelerator("CmdOrCtrl+=")
                .build(app)?;
            let zoom_out_item = MenuItemBuilder::with_id("menu-zoom-out", "Zoom Out")
                .accelerator("CmdOrCtrl+-")
                .build(app)?;
            let zoom_reset_item = MenuItemBuilder::with_id("menu-zoom-reset", "Reset Zoom")
                .accelerator("CmdOrCtrl+0")
                .build(app)?;

            let view_menu = SubmenuBuilder::new(app, "View")
                .item(&zoom_in_item)
                .item(&zoom_out_item)
                .item(&zoom_reset_item)
                .build()?;

            // Help menu items
            let about_item = PredefinedMenuItem::about(app, Some("About TrKixel"), None)?;

            let help_menu = SubmenuBuilder::new(app, "Help")
                .item(&about_item)
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&file_menu)
                .item(&edit_menu)
                .item(&view_menu)
                .item(&help_menu)
                .build()?;

            app.set_menu(menu)?;

            app.on_menu_event(|app, event| {
                let action = match event.id().0.as_str() {
                    "menu-new" => Some("new"),
                    "menu-open" => Some("open"),
                    "menu-save" => Some("save"),
                    "menu-save-as" => Some("save-as"),
                    "menu-export-png" => Some("export-png"),
                    "menu-export-svg" => Some("export-svg"),
                    "menu-undo" => Some("undo"),
                    "menu-redo" => Some("redo"),
                    "menu-zoom-in" => Some("zoom-in"),
                    "menu-zoom-out" => Some("zoom-out"),
                    "menu-zoom-reset" => Some("zoom-reset"),
                    _ => None,
                };
                if let Some(action) = action {
                    let _ = app.emit("menu-event", action);
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
