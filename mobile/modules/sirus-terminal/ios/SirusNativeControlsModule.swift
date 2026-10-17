import ExpoModulesCore
import UIKit

/// Small native controls the app draws from its own theme (`SirusNativeControls` in JS).
public class SirusNativeControlsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SirusNativeControls")

    View(SirusSegmentedControlView.self) {
      ViewName("SegmentedControl")
      Events("onSelectionChange")
      Prop("labels") { (view: SirusSegmentedControlView, value: [String]) in view.labels = value }
      Prop("selectedIndex") { (view: SirusSegmentedControlView, value: Int) in view.selectedIndex = value }
      Prop("trackColor") { (view: SirusSegmentedControlView, value: UIColor) in view.trackColor = value }
      Prop("selectedColor") { (view: SirusSegmentedControlView, value: UIColor) in view.selectedColor = value }
      Prop("textColor") { (view: SirusSegmentedControlView, value: UIColor) in view.textColor = value }
      Prop("mutedColor") { (view: SirusSegmentedControlView, value: UIColor) in view.mutedColor = value }
      Prop("appearance") { (view: SirusSegmentedControlView, value: String) in view.appearance = value }
    }
  }
}
