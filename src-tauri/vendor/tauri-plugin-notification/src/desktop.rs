// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

use serde::de::DeserializeOwned;
use tauri::{
    AppHandle, Runtime,
    plugin::{PermissionState, PluginApi},
};

use crate::NotificationBuilder;

/// Initializes the desktop implementation of the notification APIs.
pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<Notification<R>> {
    Ok(Notification(app.clone()))
}

/// Access to the notification APIs.
///
/// You can get an instance of this type via [`NotificationExt`](crate::NotificationExt)
pub struct Notification<R: Runtime>(AppHandle<R>);

impl<R: Runtime> crate::NotificationBuilder<R> {
    /// Shows the notification.
    ///
    /// When no title was set with [`Self::title`], the `productName` from the Tauri configuration is used instead.
    /// Only the title, body, icon and sound of the notification are used on desktop;
    /// the scheduling, grouping and action related options are ignored.
    ///
    /// Local Todoa patch: wait for the desktop backend and propagate its result.
    ///
    /// # Errors
    ///
    /// Returns an error when the notification could not be prepared,
    /// e.g. when the path of the running executable cannot be resolved on Windows.
    pub fn show(self) -> crate::Result<()> {
        let mut notification = imp::Notification::new(self.app.config().identifier.clone());

        if let Some(title) = self
            .data
            .title
            .or_else(|| self.app.config().product_name.clone())
        {
            notification = notification.title(title);
        }
        if let Some(body) = self.data.body {
            notification = notification.body(body);
        }
        if let Some(icon) = self.data.icon {
            notification = notification.icon(icon);
        }
        if let Some(sound) = self.data.sound {
            notification = notification.sound(sound);
        }
        notification.show()?;

        Ok(())
    }
}

impl<R: Runtime> Notification<R> {
    /// Creates a new builder for a notification.
    ///
    /// # Examples
    ///
    /// ```no_run
    /// use tauri_plugin_notification::NotificationExt;
    ///
    /// fn notify<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    ///   app.notification()
    ///     .builder()
    ///     .title("Tauri")
    ///     .body("Tauri is awesome!")
    ///     .show()
    ///     .unwrap();
    /// }
    /// ```
    pub fn builder(&self) -> NotificationBuilder<R> {
        NotificationBuilder::new(self.0.clone())
    }

    /// Requests the permission to send notifications.
    ///
    /// Desktop applications do not need to ask for this permission,
    /// but this checks Windows ToastNotifier.Setting without prompting.
    pub fn request_permission(&self) -> crate::Result<PermissionState> {
        self.permission_state()
    }

    /// Checks whether the permission to send notifications was granted.
    ///
    /// Desktop applications do not need to ask for this permission,
    /// and Windows availability is checked through ToastNotifier.Setting.
    pub fn permission_state(&self) -> crate::Result<PermissionState> {
        #[cfg(windows)]
        {
            use windows::{
                UI::Notifications::{NotificationSetting, ToastNotificationManager},
                core::HSTRING,
            };
            let id = imp::app_id(&self.0.config().identifier)?;
            let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(id))
                .map_err(|e| crate::Error::Delivery(format!("create notifier: {e}")))?;
            let setting = match notifier.Setting() {
                Ok(setting) => setting,
                // A development identity may have no notification setting record yet.
                // Report Unknown/Prompt, never Granted. Actual Show still decides acceptance.
                Err(error) if error.code().0 as u32 == 0x80070490 => {
                    return Ok(PermissionState::Prompt);
                }
                Err(error) => {
                    return Err(crate::Error::Delivery(format!("notifier setting: {error}")));
                }
            };
            Ok(if setting == NotificationSetting::Enabled {
                PermissionState::Granted
            } else {
                PermissionState::Denied
            })
        }
        #[cfg(not(windows))]
        Ok(PermissionState::Granted)
    }
}

mod imp {
    //! Types and functions related to desktop notifications.

    #[cfg(windows)]
    pub(super) fn app_id(identifier: &str) -> crate::Result<String> {
        let exe = tauri::utils::platform::current_exe()?;
        let parent = exe
            .parent()
            .ok_or_else(|| std::io::Error::other("missing executable directory"))?;
        let build = matches!(
            parent.file_name().and_then(|s| s.to_str()),
            Some("debug" | "release")
        ) && parent
            .ancestors()
            .any(|p| p.file_name().is_some_and(|s| s == "target"));
        Ok(if build {
            r"{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe"
        } else {
            identifier
        }
        .to_owned())
    }

    /// The desktop notification definition.
    ///
    /// Allows you to construct a Notification data and send it.
    ///
    /// # Examples
    /// ```rust,no_run
    /// use tauri_plugin_notification::NotificationExt;
    /// // first we build the application to access the Tauri configuration
    /// let app = tauri::Builder::default()
    ///   // on an actual app, remove the string argument
    ///   .build(tauri::generate_context!("test/tauri.conf.json"))
    ///   .expect("error while building tauri application");
    ///
    /// // shows a notification with the given title and body
    /// app.notification()
    ///   .builder()
    ///   .title("New message")
    ///   .body("You've got a new message.")
    ///   .show();
    ///
    /// // run the app
    /// app.run(|_app_handle, _event| {});
    /// ```
    #[allow(dead_code)]
    #[derive(Debug, Default)]
    pub struct Notification {
        /// The notification body.
        body: Option<String>,
        /// The notification title.
        title: Option<String>,
        /// The notification icon.
        icon: Option<String>,
        /// The notification sound.
        sound: Option<String>,
        /// The notification identifier
        identifier: String,
    }

    impl Notification {
        /// Initializes a instance of a Notification.
        pub fn new(identifier: impl Into<String>) -> Self {
            Self {
                identifier: identifier.into(),
                ..Default::default()
            }
        }

        /// Sets the notification body.
        #[must_use]
        pub fn body(mut self, body: impl Into<String>) -> Self {
            self.body = Some(body.into());
            self
        }

        /// Sets the notification title.
        #[must_use]
        pub fn title(mut self, title: impl Into<String>) -> Self {
            self.title = Some(title.into());
            self
        }

        /// Sets the notification icon.
        #[must_use]
        pub fn icon(mut self, icon: impl Into<String>) -> Self {
            self.icon = Some(icon.into());
            self
        }

        /// Sets the notification sound file.
        #[must_use]
        pub fn sound(mut self, sound: impl Into<String>) -> Self {
            self.sound = Some(sound.into());
            self
        }

        /// Shows the notification.
        ///
        /// # Examples
        ///
        /// ```no_run
        /// use tauri_plugin_notification::NotificationExt;
        ///
        /// tauri::Builder::default()
        ///   .setup(|app| {
        ///     app.notification()
        ///       .builder()
        ///       .title("Tauri")
        ///       .body("Tauri is awesome!")
        ///       .show()
        ///       .unwrap();
        ///     Ok(())
        ///   })
        ///   .run(tauri::generate_context!("test/tauri.conf.json"))
        ///   .expect("error while running tauri application");
        /// ```
        pub fn show(self) -> crate::Result<()> {
            let mut notification = notify_rust::Notification::new();
            if let Some(body) = self.body {
                notification.body(&body);
            }
            if let Some(title) = self.title {
                notification.summary(&title);
            }
            if let Some(icon) = self.icon {
                notification.icon(&icon);
            } else {
                notification.auto_icon();
            }
            if let Some(sound) = self.sound {
                notification.sound_name(&sound);
            }
            #[cfg(windows)]
            {
                notification.app_id(&app_id(&self.identifier)?);
            }
            #[cfg(target_os = "macos")]
            {
                let _ = notify_rust::set_application(if tauri::is_dev() {
                    "com.apple.Terminal"
                } else {
                    &self.identifier
                });
            }

            notification
                .show()
                .map_err(|e| crate::Error::Delivery(e.to_string()))?;

            Ok(())
        }

        /// Shows the notification. Same as [`Self::show`].
        #[cfg(feature = "windows7-compat")]
        #[allow(dead_code)]
        #[cfg_attr(docsrs, doc(cfg(feature = "windows7-compat")))]
        #[deprecated = "Tauri no longer supports Windows 7, use `Self::show` instead."]
        pub fn notify<R: tauri::Runtime>(self, _app: &tauri::AppHandle<R>) -> crate::Result<()> {
            self.show()
        }
    }
}
